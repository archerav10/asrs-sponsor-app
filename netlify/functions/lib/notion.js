const NOTION_VERSION = '2025-09-03';

async function notionFetch(path, options) {
  options = options || {};
  if (!process.env.NOTION_TOKEN) {
    throw new Error('NOTION_TOKEN is not set in this function\'s environment (check its scope includes Functions in Netlify).');
  }
  const res = await fetch('https://api.notion.com/v1' + path, Object.assign({}, options, {
    headers: Object.assign({
      'Authorization': 'Bearer ' + process.env.NOTION_TOKEN,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    }, options.headers || {})
  }));
  const json = await res.json();
  if (!res.ok) {
    throw new Error('Notion API error ' + res.status + ': ' + JSON.stringify(json));
  }
  return json;
}

// Note: the "ids" used throughout this app (SPONSORS_DB_ID, FIRST_AID_DB_ID,
// etc.) are Data Source IDs, not the older top-level Database IDs — this
// workspace's databases are multi-source, so rows are queried through the
// Data Source API rather than the legacy /databases/{id}/query endpoint.
function queryDatabase(dataSourceId, filter) {
  return notionFetch('/data_sources/' + dataSourceId + '/query', {
    method: 'POST',
    body: JSON.stringify(filter ? { filter: filter } : {})
  });
}

function updatePage(pageId, properties) {
  return notionFetch('/pages/' + pageId, {
    method: 'PATCH',
    body: JSON.stringify({ properties: properties })
  });
}

// Same multi-source-database note as queryDatabase above: the parent here
// must be a Data Source ID, not the older top-level Database ID.
function createPage(dataSourceId, properties) {
  return notionFetch('/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { type: 'data_source_id', data_source_id: dataSourceId },
      properties: properties
    })
  });
}

// Reads the common property types used across ASRS's Notion schemas down to a plain JS value.
function getPlainText(prop) {
  if (!prop) return '';
  switch (prop.type) {
    case 'title':
      return (prop.title || []).map(function (t) { return t.plain_text; }).join('');
    case 'rich_text':
      return (prop.rich_text || []).map(function (t) { return t.plain_text; }).join('');
    case 'phone_number':
      return prop.phone_number || '';
    case 'checkbox':
      return prop.checkbox;
    case 'select':
      return prop.select ? prop.select.name : '';
    case 'date':
      return prop.date ? prop.date.start : '';
    case 'url':
      return prop.url || '';
    default:
      return '';
  }
}

module.exports = { notionFetch, queryDatabase, updatePage, createPage, getPlainText };
