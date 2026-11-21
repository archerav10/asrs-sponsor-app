const { unzipEntry, decode } = require('./docx');

// Reads an Excel .xlsx without a library: the workbook's sheet names, and
// each sheet's cells as their stored values (the values Excel or Google
// Sheets last calculated for formulas). readXlsx(buffer) ->
//   { sheetNames: [...], sheet(name) -> rows: [[value, ...], ...] }
// Values are strings or numbers; empty cells are ''. Rows and columns keep
// their spreadsheet positions (row 1 is rows[0], column A is [0]).

function text(xml) {
  // A shared string or inline string: its <t> runs, leaving out phonetic hints.
  return decode((xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || [])
    .map(function (t) { return t.replace(/^<t\b[^>]*>/, '').replace(/<\/t>$/, ''); }).join(''));
}

function colIndex(ref) {
  const letters = ref.replace(/\d+$/, '');
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

function readXlsx(buffer) {
  const workbook = unzipEntry(buffer, 'xl/workbook.xml').toString('utf8');
  const rels = (unzipEntry(buffer, 'xl/_rels/workbook.xml.rels', true) || Buffer.from('')).toString('utf8');
  const shared = (unzipEntry(buffer, 'xl/sharedStrings.xml', true) || Buffer.from('')).toString('utf8');
  const strings = (shared.match(/<si\b[\s\S]*?<\/si>/g) || []).map(text);
  const targets = {};
  (rels.match(/<Relationship\b[^>]*>/g) || []).forEach(function (r) {
    const id = /Id="([^"]+)"/.exec(r), t = /Target="([^"]+)"/.exec(r);
    if (id && t) targets[id[1]] = t[1].replace(/^\/?xl\//, '').replace(/^\//, '');
  });
  const sheets = {};
  const names = [];
  (workbook.match(/<sheet\b[^>]*>/g) || []).forEach(function (s) {
    const name = decode((/name="([^"]*)"/.exec(s) || [])[1] || '');
    const rid = (/r:id="([^"]+)"/.exec(s) || [])[1];
    if (name && rid && targets[rid]) { sheets[name] = 'xl/' + targets[rid]; names.push(name); }
  });
  const cache = {};
  function sheet(name) {
    if (cache[name]) return cache[name];
    if (!sheets[name]) return null;
    const xml = unzipEntry(buffer, sheets[name]).toString('utf8');
    const rows = [];
    (xml.match(/<row\b[\s\S]*?<\/row>|<row\b[^>]*\/>/g) || []).forEach(function (rowXml) {
      const r = Number((/\br="(\d+)"/.exec(rowXml) || [])[1]) - 1;
      if (r < 0) return;
      const row = [];
      (rowXml.match(/<c\b[^>]*\/>|<c\b[\s\S]*?<\/c>/g) || []).forEach(function (c) {
        const ref = (/\br="([A-Z]+\d+)"/.exec(c) || [])[1];
        if (!ref) return;
        const type = (/\bt="([^"]+)"/.exec(c) || [])[1] || 'n';
        const v = /<v>([\s\S]*?)<\/v>/.exec(c);
        let val = '';
        if (type === 's') val = v ? (strings[Number(v[1])] || '') : '';
        else if (type === 'inlineStr') val = text(c);
        else if (type === 'str' || type === 'e') val = v ? decode(v[1]) : '';
        else if (type === 'b') val = v ? (v[1] === '1' ? 'TRUE' : 'FALSE') : '';
        else val = v && v[1] !== '' ? Number(v[1]) : '';
        row[colIndex(ref)] = val;
      });
      for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
      rows[r] = row;
    });
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    cache[name] = rows;
    return rows;
  }
  return { sheetNames: names, sheet: sheet };
}

// An Excel date serial (days since 1899-12-30) -> yyyy-mm-dd.
function excelDate(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const s = String(v || '');
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
  return '';
}

module.exports = { readXlsx, excelDate };
