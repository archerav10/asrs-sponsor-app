// Notion data source and Drive folder IDs that aren't secrets, kept in
// code instead of Netlify environment variables. AWS Lambda caps a
// function's environment at 4 KB in total and this site's settings had
// reached it, so new non-secret IDs belong here. An environment variable
// of the same name still wins, for pointing a deploy at test copies.
const IDS = {
  MEDICAL_APPOINTMENTS_DB_ID: '389478b3-1169-4b1d-8dcb-abb37e621173',
  APPOINTMENT_LOG_DB_ID: '9691fcba-c42f-4dd2-9aa8-c5f206cf6900',
  WEEKLY_FOCUS_DB_ID: 'e0ab3391-ddb7-45d8-9ca6-9f1aed7f1a23',
  WEEKLY_FOCUS_RESPONSES_DB_ID: '42a2aa61-dc05-4fe7-95fa-ca147346b783',
  FACILITY_REPORTING_ROOT_FOLDER_ID: '19lpJYy9FIKZAb1aacyTrOpVNv-y05Gdv',
  SPONSOR_GUIDANCE_FOLDER_ID: '1DEzNT_19RJeKr0OMk87AqBRPcBb2LzEj',
  VEHICLES_DB_ID: '1ce99254-d2f5-4933-a514-52df8afd7cb8',
  VEHICLE_SERVICES_DB_ID: '4fa814a0-4c2d-4d35-a87d-9494dc02a672',
  SPONSOR_INTAKES_DB_ID: '6ce53041-85dd-4d46-adc8-2b9f1efa42e3',
  SPONSOR_INTAKE_ITEMS_DB_ID: 'ad48c1d8-9cd8-4980-b580-40a12dc7aa41',
  SPONSOR_INTAKE_STAGES_DB_ID: '813f9810-4bfb-45e5-9782-bbb21d90a9bc',
  SPONSOR_INTAKE_STEPS_DB_ID: '446736ee-ef52-4068-8c06-411513ff3492',
  SPONSOR_INTAKE_ROOT_FOLDER_ID: '1A3LrLbu_T2mn80FkKsmyjum0xWwCN3A8',
  // A Google OAuth client ID is public by design (it's sent to browsers in
  // sign-in links); the client secret and refresh token stay in Netlify.
  GOOGLE_OAUTH_CLIENT_ID: '650411460927-99qvctvtjq2nc8883mmvr8ddgij850gh.apps.googleusercontent.com'
};

function id(name) {
  return process.env[name] || IDS[name];
}

module.exports = { id };
