import 'dotenv/config';

const token = process.env.NOTION_ACCESS_TOKEN;
const dataSourceId = process.env.NOTION_APPLICATIONS_DATA_SOURCE_ID;
const headers = {
  Authorization: `Bearer ${token}`,
  'Notion-Version': '2025-09-03',
  'Content-Type': 'application/json',
};
const request = async (path, options = {}) => {
  const response = await fetch(`https://api.notion.com/v1/${path}`, { headers, signal: AbortSignal.timeout(15000), ...options });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
};

const me = await request('users/me');
const records = [];
let cursor;
do {
  const body = await request(`data_sources/${dataSourceId}/query`, {
    method: 'POST',
    body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
  });
  records.push(...body.results);
  cursor = body.has_more ? body.next_cursor : null;
} while (cursor);

const plain = (p) => (p?.title || p?.rich_text || []).map((v) => v.plain_text || '').join('');
const createdByIntegration = records.filter((r) => r.created_by?.id === me.id);
const preexistingEditedByIntegration = records.filter((r) => r.created_by?.id !== me.id && r.last_edited_by?.id === me.id);
const beforeHeartflow = createdByIntegration.filter((r) => {
  const d = r.properties['Apply Date']?.date?.start;
  return d && d < '2026-07-07';
});
const creationTimes = createdByIntegration.map((r) => r.created_time).sort();
console.log(JSON.stringify({
  totalRecords: records.length,
  integrationUserId: me.id,
  createdByIntegration: createdByIntegration.length,
  activeIntegrationCreated: createdByIntegration.map((r) => ({
    id: r.id,
    company: plain(r.properties.Company),
    position: plain(r.properties.Position),
    applyDate: r.properties['Apply Date']?.date?.start || null,
  })),
  integrationCreatedTimeRange: creationTimes.length ? [creationTimes[0], creationTimes.at(-1)] : [],
  integrationCreatedBeforeHeartflow: beforeHeartflow.length,
  preexistingEditedByIntegration: preexistingEditedByIntegration.length,
  samplePreexistingEdited: preexistingEditedByIntegration.slice(0, 20).map((r) => ({
    id: r.id,
    company: plain(r.properties.Company),
    position: plain(r.properties.Position),
    applyDate: r.properties['Apply Date']?.date?.start || null,
    lastEditedTime: r.last_edited_time,
  })),
  sampleBeforeHeartflow: beforeHeartflow.slice(0, 10).map((r) => ({
    id: r.id,
    company: plain(r.properties.Company),
    position: plain(r.properties.Position),
    applyDate: r.properties['Apply Date']?.date?.start || null,
  })),
}, null, 2));
