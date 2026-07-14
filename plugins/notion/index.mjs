// @ts-check
// ── Reference seed ── This bundled plugin is a stable, reviewed example. To
// extend it, publish career-ops-plugin-<id> with "supersedesBundled": true and
// your version takes precedence once installed (see docs/PLUGINS.md). Bundled
// seeds take only security/compat fixes — feature work happens in the successor repo.
//
// Notion plugin — mirror your tracker to a Notion database (export) and read
// records back as job leads (search).
//
// Built on the Notion backend contributed by @pcomans in #959 (with thanks),
// reshaped per the plugin contract. The decisive change: Notion is an OPT-IN
// MIRROR, not a replacement backend. data/applications.md stays the canonical
// source of truth (the web reads it); `export` pushes a read-only snapshot of it
// to the user's own Notion DB. The core never writes to Notion as primary, and
// modes are not edited — this lives entirely behind `node plugins.mjs run notion`.
//
// Setup: a "Career Ops" parent page in Notion containing an "Applications" DB
// with Company / Role / Status / Score / URL properties, shared with your
// internal integration. Enable in config/plugins.yml; keys in .env.
//
//   node plugins.mjs run notion export            # mirror tracker → Notion
//   node plugins.mjs run notion search "platform" # read matching records → pipeline

import { createNotionClient, rich } from './_notion.mjs';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

function loadSyncMetadata() {
  const path = join(process.cwd(), 'data', 'notion-sync.yml');
  if (!existsSync(path)) return { sync_start_id: null, applications: {} };
  return yaml.load(readFileSync(path, 'utf8')) || { sync_start_id: null, applications: {} };
}

// Maps career-ops canonical statuses → this user's Notion "Application Status" options.
// Edit values here if you rename options in Notion.
const NOTION_STATUS_MAP = {
  'evaluated':  null,          // never exported — see NOTION_EXPORT_STATUSES
  'applied':    'Applied',
  'responded':  'HR contact',
  'interview':  'In progress',
  'offer':      'OFFER',
  'rejected':   'Rejected',
  'discarded':  'No Response',
  'skip':       null,
  'referred':   'Referred',
};
// Only mirror rows the user has actually submitted. Evaluated/SKIP stay local.
const NOTION_EXPORT_STATUSES = new Set([
  'applied', 'responded', 'interview', 'offer', 'rejected', 'discarded', 'referred',
]);
function normalizeTrackerStatus(raw) {
  return String(raw ?? '').replace(/\*\*/g, '').trim().toLowerCase();
}
function toNotionStatus(raw) {
  const key = normalizeTrackerStatus(raw);
  if (!key) return null;
  return NOTION_STATUS_MAP[key] ?? null;
}
function shouldExportRow(row) {
  const key = normalizeTrackerStatus(row.status);
  return NOTION_EXPORT_STATUSES.has(key);
}

function clientFromCtx(ctx) {
  return createNotionClient({
    token: ctx?.env?.NOTION_ACCESS_TOKEN,
    parent: ctx?.env?.NOTION_PARENT_PAGE_ID,
    applicationsDatabase: ctx?.env?.NOTION_APPLICATIONS_DATABASE_ID,
    applicationsDataSource: ctx?.env?.NOTION_APPLICATIONS_DATA_SOURCE_ID,
    fetch: ctx?.fetch, // route through the engine's allowedHosts/redirect guard
  });
}

async function applicationsDb(client) {
  if (client.applicationsDataSource) return client.applicationsDataSource;
  if (client.applicationsDatabase) return client.resolveDatabase(client.applicationsDatabase);
  const dbs = await client.resolveDBs();
  const apps = dbs['Applications'];
  if (!apps) throw new Error('No "Applications" database found under the Career Ops page — create it and share the integration with it.');
  return apps;
}

/**
 * Parse a tracker score cell into a numeric value for the Notion DB Score property.
 *
 * Scores in applications.md may be formatted like `4.2/5`, `**4.2/5**`, `4.25`, etc.
 * Strips formatting and extracts the first numeric value so slash-formatted
 * scores (e.g. 4.2/5) are not mangled into 4.25 (#1414).
 *
 * @param {unknown} s - Raw score value from tracker row.
 * @returns {number} Parsed score, or NaN if no valid number is present.
 */
export function parseScore(s) {
  const m = String(s ?? '').replace(/\*\*/g, '').match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : NaN;
}

export default {
  parseScore,

  /**
   * export: upsert each tracker row into the user's Notion Applications DB.
   * Receives a frozen read-only snapshot of the tracker — never a file handle.
   * @param {{ applications: Array<Record<string,string>> }} snapshot
   * @param {any} ctx
   */
  async export(snapshot, ctx) {
    const allRows = Array.isArray(snapshot?.applications) ? snapshot.applications : [];
    const syncMetadata = loadSyncMetadata();
    const syncStartId = Number.parseInt(ctx?.env?.NOTION_SYNC_START_ID || syncMetadata.sync_start_id || '', 10);
    const rows = Number.isFinite(syncStartId)
      ? allRows.filter((row) => Number.parseInt(row['#'] || '', 10) >= syncStartId)
      : allRows;
    if (rows.length === 0) return { pushed: 0 };
    const client = clientFromCtx(ctx);
    const apps = await applicationsDb(client);

    // Fetch all existing Notion records once to avoid N+1 queries.
    const existing = await client.queryDB(apps);
    const textValue = (p) => (p?.title || p?.rich_text || []).map((v) => v.plain_text || '').join('').trim();
    const keyFor = (company, role) => `${company.toLowerCase()}\u0000${role.toLowerCase()}`;
    const existingMap = new Map();
    const blankRoleByCompany = new Map();
    for (const record of existing) {
      const company = textValue(record.properties.Company);
      const role = textValue(record.properties.Position || record.properties.Role);
      if (!company) continue;
      if (role) existingMap.set(keyFor(company, role), record.id);
      else {
        const key = company.toLowerCase();
        if (!blankRoleByCompany.has(key)) blankRoleByCompany.set(key, []);
        blankRoleByCompany.get(key).push(record.id);
      }
    }

    let pushed = 0;
    // Push newest tracker entries first so recent status changes are mirrored
    // promptly even when a large tracker takes a while to synchronize fully.
    for (const row of [...rows].reverse()) {
      const company = (row.company || '').trim();
      const role = (row.role || '').trim();
      if (!company || !role) continue;
      if (!shouldExportRow(row)) continue;
      const trackerId = String(row['#'] || '').trim();
      const metadata = syncMetadata.applications?.[trackerId];
      const required = ['industry', 'website', 'location', 'work_arrangement'];
      const missing = required.filter((key) => {
        const value = metadata?.[key];
        return value == null || value === '' || (Array.isArray(value) && value.length === 0);
      });
      if (missing.length) throw new Error(`Tracker #${trackerId} is missing Notion metadata: ${missing.join(', ')}`);

      const props = { Company: { title: rich(company) } };
      props.Position = { rich_text: rich(role) };
      if (row.date) props['Apply Date'] = { date: { start: row.date } };
      if (row.notes) props.Others = { rich_text: rich(row.notes) };
      props.Industry = { multi_select: metadata.industry.map((name) => ({ name })) };
      props['Website/LinkedIn'] = { url: metadata.website };
      props.Location = { multi_select: metadata.location.map((name) => ({ name })) };
      props['Work arrangement'] = { multi_select: metadata.work_arrangement.map((name) => ({ name })) };
      const notionStatus = toNotionStatus(row.status);
      if (notionStatus) props['Application Status'] = { status: { name: notionStatus } };

      if (ctx?.dryRun) { ctx.log(`would push: ${company} — ${role}`); pushed++; continue; }

      let existingId = existingMap.get(keyFor(company, role));
      if (!existingId) existingId = blankRoleByCompany.get(company.toLowerCase())?.shift();
      if (existingId) await client.api(`pages/${existingId}`, 'PATCH', { properties: props });
      else await client.createPage(apps, props);
      pushed++;
    }
    return { pushed };
  },

  /**
   * search: return Notion records matching a query as Job[]. Only records that
   * carry a job posting in a `URL` property are returned (e.g. a postings DB, or
   * leads you added in Notion). Note: `export` mirrors the tracker (company/role/
   * status/score) and does NOT set a job URL, so export-created rows are not
   * round-tripped by search — that's intentional, they already live in your
   * tracker. The engine writes any results to the pipeline canonically.
   * @param {string} query
   * @param {any} ctx
   */
  async search(query, ctx) {
    const client = clientFromCtx(ctx);
    const apps = await applicationsDb(client);
    const hits = await client.findRecords(apps, query);
    return hits
      .filter((h) => h.jobUrl && /^https?:\/\//i.test(h.jobUrl))
      .map((h) => ({ title: h.role || 'Notion record', url: h.jobUrl, company: h.company || '', location: '' }));
  },
};
