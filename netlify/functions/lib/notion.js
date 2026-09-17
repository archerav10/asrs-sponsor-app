const NOTION_VERSION = '2022-06-28';

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

function queryDatabase(databaseId, filter) {
  return notionFetch('/databases/' + databaseId + '/query', {
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
    default:
      return '';
  }
}

module.exports = { notionFetch, queryDatabase, updatePage, getPlainText };
