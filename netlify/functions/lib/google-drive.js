// Read-only Google Drive access on the server, the same way the
// inspector portal (asrscompliance.com) does it: the functions call Drive
// with a stored OAuth grant (GOOGLE_OAUTH_CLIENT_ID / _CLIENT_SECRET /
// _REFRESH_TOKEN, the same values as that site), and the browser only
// ever talks to this app. Sponsors never need a Google account, and the
// Drive folders stay private — nothing is link-shared.

const FOLDER_MIME = 'application/vnd.google-apps.folder';

// Google Docs/Sheets/Slides have no bytes of their own; they're exported.
const EXPORT_MIME = {
  'application/vnd.google-apps.document': 'application/pdf',
  'application/vnd.google-apps.spreadsheet': 'application/pdf',
  'application/vnd.google-apps.presentation': 'application/pdf'
};

// A sync function's response is capped at 6 MB, and the file goes back
// base64-encoded (4/3 larger).
const MAX_FILE_BYTES = 4 * 1024 * 1024;

let cached = null; // { token, expiresAt } — reused while the function stays warm

async function accessToken() {
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.token;
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refresh = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!id || !secret || !refresh) throw new Error('Google Drive access isn\'t set up (GOOGLE_OAUTH_* in Netlify).');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' })
  });
  if (!res.ok) {
    console.error('Google token refresh failed', res.status, await res.text());
    throw new Error('Couldn\'t connect to Google Drive.');
  }
  const json = await res.json();
  cached = { token: json.access_token, expiresAt: Date.now() + (json.expires_in || 3600) * 1000 };
  return cached.token;
}

async function driveGet(path, params) {
  const url = 'https://www.googleapis.com/drive/v3/' + path + (params ? '?' + new URLSearchParams(params).toString() : '');
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + await accessToken() } });
  if (!res.ok) {
    const text = await res.text();
    console.error('Drive ' + path + ' failed', res.status, text);
    const err = new Error(res.status === 404 ? 'That file or folder wasn\'t found.' : 'Google Drive returned an error.');
    err.statusCode = res.status === 404 ? 404 : 502;
    throw err;
  }
  return res;
}

function quote(s) { return '\'' + String(s).replace(/\\/g, '\\\\').replace(/'/g, '\\\'') + '\''; }

async function listFolder(folderId) {
  const items = [];
  let pageToken = '';
  do {
    const params = {
      q: quote(folderId) + ' in parents and trashed = false',
      fields: 'nextPageToken, files(id,name,mimeType,modifiedTime,size)',
      orderBy: 'folder,name',
      pageSize: '200',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true'
    };
    if (pageToken) params.pageToken = pageToken;
    const json = await (await driveGet('files', params)).json();
    (json.files || []).forEach(function (f) {
      items.push({ id: f.id, name: f.name, isFolder: f.mimeType === FOLDER_MIME, mimeType: f.mimeType, modifiedTime: f.modifiedTime, size: f.size ? Number(f.size) : null });
    });
    pageToken = json.nextPageToken || '';
  } while (pageToken && items.length < 1000);
  return items;
}

// The child folder with exactly this name, or null.
async function findChildFolder(parentId, name) {
  const json = await (await driveGet('files', {
    q: quote(parentId) + ' in parents and trashed = false and mimeType = ' + quote(FOLDER_MIME) + ' and name = ' + quote(name),
    fields: 'files(id,name)',
    pageSize: '5',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true'
  })).json();
  return (json.files && json.files[0]) ? json.files[0].id : null;
}

async function getMeta(fileId) {
  return (await driveGet('files/' + encodeURIComponent(fileId), { fields: 'id,name,mimeType,parents,size', supportsAllDrives: 'true' })).json();
}

// True when fileId is rootId or sits somewhere beneath it — so a browser
// can only ever open things inside the folder it was given.
async function isWithin(fileId, rootId, maxDepth) {
  let ids = [fileId];
  for (let depth = 0; depth <= (maxDepth || 10) && ids.length; depth++) {
    if (ids.indexOf(rootId) !== -1) return true;
    const parents = [];
    for (const id of ids) {
      const meta = await getMeta(id);
      (meta.parents || []).forEach(function (p) { parents.push(p); });
    }
    ids = parents;
  }
  return false;
}

// { name, contentType, buffer }. Throws 413 for files too large to send back.
async function fileContent(fileId) {
  const meta = await getMeta(fileId);
  if (meta.mimeType === FOLDER_MIME) {
    const err = new Error('That\'s a folder.');
    err.statusCode = 400;
    throw err;
  }
  const exportMime = EXPORT_MIME[meta.mimeType];
  if (!exportMime && meta.mimeType && meta.mimeType.indexOf('application/vnd.google-apps.') === 0) {
    const err = new Error('This kind of Google file can\'t be opened in the app.');
    err.statusCode = 415;
    throw err;
  }
  if (!exportMime && meta.size && Number(meta.size) > MAX_FILE_BYTES) {
    const err = new Error('This file is too large to open in the app. Ask the office for a copy.');
    err.statusCode = 413;
    throw err;
  }
  const res = exportMime
    ? await driveGet('files/' + encodeURIComponent(fileId) + '/export', { mimeType: exportMime })
    : await driveGet('files/' + encodeURIComponent(fileId), { alt: 'media', supportsAllDrives: 'true' });
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_FILE_BYTES) {
    const err = new Error('This file is too large to open in the app. Ask the office for a copy.');
    err.statusCode = 413;
    throw err;
  }
  return { name: meta.name, contentType: exportMime || meta.mimeType || 'application/octet-stream', buffer: buffer, exported: !!exportMime };
}

module.exports = { listFolder, findChildFolder, getMeta, isWithin, fileContent, FOLDER_MIME };
