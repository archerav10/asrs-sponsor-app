const zlib = require('zlib');

// Reads the text of a Word .docx without a library: a .docx is a zip, and
// word/document.xml holds the body. Returns the body's blocks in order:
//   { type: 'p', text }                       a paragraph
//   { type: 'table', rows: [[cellText, ...]] } a table (merged cells once)
// Text keeps line breaks between a cell's paragraphs; tracked deletions are
// dropped, insertions kept.

// The bytes of one file in a zip (wanted: its path, e.g. word/document.xml).
// Throws when it isn't there; with `optional`, returns null instead.
function unzipEntry(buf, wanted, optional) {
  // End of central directory: last 22+ bytes, signature 0x06054b50.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a .docx file (no zip directory).');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === wanted) {
      const lNameLen = buf.readUInt16LE(local + 26);
      const lExtraLen = buf.readUInt16LE(local + 28);
      const start = local + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compSize);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error('Unsupported zip compression in the .docx.');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (optional) return null;
  throw new Error(wanted === 'word/document.xml' ? 'Not a Word document (no word/document.xml).' : 'The file has no ' + wanted + '.');
}

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, function (m, e) {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
  });
}

// A minimal element tree of document.xml.
function parseXml(xml) {
  const root = { name: '#root', children: [] };
  const stack = [root];
  const re = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^>]*?)?)(\/?)>|([^<]+)|<\?[^>]*\?>|<!--[\s\S]*?-->/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) { top.children.push({ text: decode(m[5]) }); continue; }
    if (!m[2]) continue;
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    const el = { name: m[2], attrs: m[3] || '', children: [] };
    top.children.push(el);
    if (!m[4]) stack.push(el);
  }
  return root;
}

function find(el, name) {
  if (el.name === name) return el;
  for (const c of el.children || []) { const f = find(c, name); if (f) return f; }
  return null;
}

// Text of a paragraph (w:p).
function paraText(p) {
  let out = '';
  (function walk(el) {
    for (const c of el.children || []) {
      if (c.text !== undefined) continue;
      if (c.name === 'w:del' || c.name === 'w:delText' || c.name === 'w:instrText') continue;
      if (c.name === 'w:t') out += c.children.map(function (x) { return x.text || ''; }).join('');
      else if (c.name === 'w:tab') out += '\t';
      else if (c.name === 'w:br' || c.name === 'w:cr') out += '\n';
      else walk(c);
    }
  })(p);
  return out;
}

function cellText(tc) {
  const lines = [];
  (function walk(el) {
    for (const c of el.children || []) {
      if (c.name === 'w:p') lines.push(paraText(c));
      else if (c.name === 'w:tbl') walk(c); // a table inside a cell: its text, in order
      else if (c.name && c.name !== 'w:tcPr') walk(c);
    }
  })(tc);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function tableRows(tbl) {
  return tbl.children.filter(function (c) { return c.name === 'w:tr'; }).map(function (tr) {
    return tr.children.filter(function (c) { return c.name === 'w:tc' || c.name === 'w:sdt'; }).map(function (tc) {
      return cellText(tc);
    });
  });
}

function readDocx(buffer) {
  const xml = unzipEntry(buffer, 'word/document.xml').toString('utf8');
  const body = find(parseXml(xml), 'w:body');
  if (!body) throw new Error('The Word document has no body.');
  const blocks = [];
  (function walk(el) {
    for (const c of el.children) {
      if (c.name === 'w:p') { const t = paraText(c).trim(); if (t) blocks.push({ type: 'p', text: t }); }
      else if (c.name === 'w:tbl') blocks.push({ type: 'table', rows: tableRows(c) });
      else if (c.name === 'w:sdt' || c.name === 'w:sdtContent') walk(c);
    }
  })(body);
  return blocks;
}

module.exports = { readDocx, unzipEntry, decode };
