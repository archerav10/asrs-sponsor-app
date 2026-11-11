const drive = require('./google-drive');

// Picks up documents that were put straight into a Drive folder (dragged
// in, scanned, saved from email) rather than uploaded through the app.
// Each module knows its own folders; this file only knows how to read a
// hand-placed file's name. The convention (documented on the dashboard's
// File Naming Guide, admin-dashboard/naming-guide.html):
//
//   {Code}_{Date}.pdf       e.g.  FirstAidCPR_2026-10-15.pdf
//                                 ISP_20261101.pdf
//
// The folder says who the document is for, so the name carries only the
// document's Code (from that module's checklist, any letter case) and,
// where the module needs one, a date. Names the app itself builds
// ("{location}_Staff_{id}_{key}_{date}", "{location}_Resident_{initials}
// _{service}_{key}_{date}") and the older Document_Compliance_Tracker
// names ("{location}_Resident_{initials}_{code}_{date}") are read too.

// The old ASRS Doc Codes (Notion) names for items whose app Key is
// different, so files filed under the tracker's codes are still
// recognized. New files should use the Key shown on the naming guide.
const LEGACY_CODES = {
  // Staff Training
  FirstAid: 'FirstAidCPR',
  TOVA: 'BehaviorManagement',
  MedRef: 'MedicationAdminRefresher',
  TBAssess: 'TBTest',
  TBAssessment: 'TBTest',
  HIPPA: 'HIPAATraining',
  UnivPrec: 'UniversalPrecautions',
  Serious: 'SeriousIncidentReporting',
  EmerPrep: 'EmergencyPreparation',
  RoleRev: 'RolesAndResponsibilities',
  DoForYou: 'HowWeTreatResidents',
  PersonCentered: 'PersonCenteredThinking',
  DSPComp: 'DSPCompetencies',
  PerfRev: 'AnnualPerformanceEval',
  JobApp: 'Application',
  Certifications: 'Diploma',
  Identifications: 'DriversLicenseID',
  DisclosureForm: 'BackgroundCheckDisclosure',
  CentralRegistry: 'CentralRegistryCheck',
  '32HrMedAdmin': 'MedAdmin32Hour',
  DocTraining: 'DocumentationTraining',
  OrientationTraining: 'ASRSOrientation',
  RefChecks: 'ReferenceLetters'
};

// Who filled in a step from a hand-placed file (Last Updated By).
const DRIVE_SOURCE = 'Google Drive (filed by hand)';

function baseName(name) {
  const dot = (name || '').lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : (name || '');
}

function strip(s) { return (s || '').replace(/[^A-Za-z0-9]/g, ''); }

function validDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
  return dt.toISOString().slice(0, 10);
}

// The first date in a name, as YYYY-MM-DD: 2026-10-15, 20261015, or the
// US order 10-15-2026 / 10152026. '' when there's none.
const DATE_PATTERNS = [
  { re: /(?<!\d)(\d{4})[-.]?(\d{2})[-.]?(\d{2})(?!\d)/g, y: 1, m: 2, d: 3 },
  { re: /(?<!\d)(\d{1,2})[-.](\d{1,2})[-.](\d{4})(?!\d)/g, y: 3, m: 1, d: 2 },
  { re: /(?<!\d)(\d{2})(\d{2})(\d{4})(?!\d)/g, y: 3, m: 1, d: 2 }
];

function dateInName(base) {
  for (const p of DATE_PATTERNS) {
    for (const m of (base || '').matchAll(p.re)) {
      const iso = validDate(+m[p.y], +m[p.m], +m[p.d]);
      if (iso && iso >= '1990-01-01' && iso <= '2099-12-31') return iso;
    }
  }
  return '';
}

// Turns a list of valid codes into a case-insensitive lookup that also
// knows LEGACY_CODES (only for legacy names whose target is on the list).
function codeLookup(codes) {
  const map = {};
  codes.forEach(function (c) { map[c.toLowerCase()] = c; });
  Object.keys(LEGACY_CODES).forEach(function (old) {
    const target = LEGACY_CODES[old];
    if (codes.indexOf(target) !== -1 && !map[old.toLowerCase()]) map[old.toLowerCase()] = target;
  });
  return map;
}

// { code, date } for a file name, where code is one of `codes` (or '' if
// the name doesn't name one) and date is '' when the name has none.
// `rawCode` is what was read in the code's place, for error messages.
function parseDocName(name, codes) {
  const lookup = codeLookup(codes);
  const base = baseName(name);
  const parts = base.split('_');
  const candidates = [];
  // The app's own names and the tracker's: the code is in a fixed slot.
  if (parts[1] === 'Resident' && parts.length === 6) candidates.push(parts[4]);
  if ((parts[1] === 'Resident' || parts[1] === 'Staff') && parts.length === 5) candidates.push(parts[3]);
  // Everything else starts with the code: "ISP_2026..." or "ISP 2026...",
  // "W-4_2026..." (punctuation inside the code is ignored).
  const first = base.split(/[_\s]+/)[0];
  candidates.push(first);
  candidates.push((first.match(/^[A-Za-z0-9]+/) || [''])[0]);

  let code = '';
  for (const c of candidates) {
    const hit = lookup[strip(c).toLowerCase()];
    if (hit) { code = hit; break; }
  }
  return { code: code, rawCode: strip(candidates[0]) || strip(first), date: dateInName(base) };
}

// Files (not folders) in a folder, plus those in its subfolders when
// depth > 0. Each { id, name, modifiedTime, folderName }.
async function listFiles(folderId, depth) {
  const items = await drive.listFolder(folderId);
  const files = [];
  for (const item of items) {
    if (!item.isFolder) {
      files.push({ id: item.id, name: item.name, modifiedTime: item.modifiedTime, folderName: '' });
    } else if (depth > 0) {
      (await listFiles(item.id, depth - 1)).forEach(function (f) {
        files.push(Object.assign(f, { folderName: f.folderName ? item.name + '/' + f.folderName : item.name }));
      });
    }
  }
  return files;
}

// True when a recorded filename (often stored without its extension) is
// this Drive file.
function sameFile(recorded, name) {
  if (!recorded) return false;
  return recorded === name || recorded === baseName(name);
}

module.exports = { LEGACY_CODES, DRIVE_SOURCE, baseName, dateInName, parseDocName, listFiles, sameFile };
