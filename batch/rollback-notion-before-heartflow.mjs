import 'dotenv/config';

const apply = process.argv.includes('--apply');
const token = process.env.NOTION_ACCESS_TOKEN;
const dataSourceId = process.env.NOTION_APPLICATIONS_DATA_SOURCE_ID;
const headers = {
  Authorization: `Bearer ${token}`,
  'Notion-Version': '2025-09-03',
  'Content-Type': 'application/json',
};
const request = async (path, options = {}) => {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(`https://api.notion.com/v1/${path}`, {
        headers,
        signal: AbortSignal.timeout(20000),
        ...options,
      });
      if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw lastError;
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

const targets = records.filter((r) => {
  const applyDate = r.properties['Apply Date']?.date?.start;
  return r.created_by?.id === me.id && applyDate && applyDate < '2026-07-07';
});

if (apply) {
  for (const record of targets) {
    await request(`pages/${record.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    });
  }
}

console.log(JSON.stringify({ mode: apply ? 'applied' : 'dry-run', archived: apply ? targets.length : 0, targets: targets.length }));
