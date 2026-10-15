// Notion data source and Drive folder IDs that aren't secrets, kept in
// code instead of Netlify environment variables. AWS Lambda caps a
// function's environment at 4 KB in total and this site's settings had
// reached it, so new non-secret IDs belong here. An environment variable
// of the same name still wins, for pointing a deploy at test copies.
const IDS = {
  MEDICAL_APPOINTMENTS_DB_ID: '389478b3-1169-4b1d-8dcb-abb37e621173',
  WEEKLY_FOCUS_DB_ID: 'e0ab3391-ddb7-45d8-9ca6-9f1aed7f1a23',
  WEEKLY_FOCUS_RESPONSES_DB_ID: '42a2aa61-dc05-4fe7-95fa-ca147346b783',
  FACILITY_REPORTING_ROOT_FOLDER_ID: '19lpJYy9FIKZAb1aacyTrOpVNv-y05Gdv',
  SPONSOR_GUIDANCE_FOLDER_ID: '1DEzNT_19RJeKr0OMk87AqBRPcBb2LzEj'
};

function id(name) {
  return process.env[name] || IDS[name];
}

module.exports = { id };
