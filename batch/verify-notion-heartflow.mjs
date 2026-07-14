import 'dotenv/config';

const token = process.env.NOTION_ACCESS_TOKEN;
const dataSourceId = process.env.NOTION_APPLICATIONS_DATA_SOURCE_ID;
const companies = process.argv.slice(2);
const targets = companies.length ? companies : ['Heartflow'];
const response = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Notion-Version': '2025-09-03',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    page_size: 20,
    filter: targets.length === 1
      ? { property: 'Company', title: { equals: targets[0] } }
      : { or: targets.map((company) => ({ property: 'Company', title: { equals: company } })) },
  }),
});

if (!response.ok) throw new Error(`Notion verification failed: ${response.status} ${await response.text()}`);
const body = await response.json();
const plain = (p) => (p?.title || p?.rich_text || []).map((v) => v.plain_text || '').join('');
console.log(JSON.stringify(body.results.map((r) => ({
  company: plain(r.properties.Company),
  position: plain(r.properties.Position),
  applyDate: r.properties['Apply Date']?.date?.start || null,
  status: r.properties['Application Status']?.status?.name || null,
  industry: r.properties.Industry?.multi_select?.map((v) => v.name) || [],
  website: r.properties['Website/LinkedIn']?.url || null,
  location: r.properties.Location?.multi_select?.map((v) => v.name) || [],
  workArrangement: r.properties['Work arrangement']?.multi_select?.map((v) => v.name) || [],
  others: plain(r.properties.Others),
})), null, 2));
