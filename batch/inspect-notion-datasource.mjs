import 'dotenv/config';

const dataSourceId = process.argv[2];
if (!dataSourceId) throw new Error('Pass a Notion data source ID.');
const response = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}`, {
  headers: {
    Authorization: `Bearer ${process.env.NOTION_ACCESS_TOKEN}`,
    'Notion-Version': '2025-09-03',
  },
  signal: AbortSignal.timeout(15000),
});
if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
const body = await response.json();
console.log(JSON.stringify({
  title: body.title?.map((v) => v.plain_text).join('') || '',
  properties: Object.fromEntries(Object.entries(body.properties || {}).map(([name, value]) => [name, {
    type: value.type,
    options: value[value.type]?.options?.map((option) => option.name) || [],
    groups: value[value.type]?.groups?.map((group) => group.name) || [],
  }])),
}, null, 2));
