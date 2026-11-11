// Notion data source and Drive folder IDs that aren't secrets, kept in
// code instead of Netlify environment variables. AWS Lambda caps a
// function's environment at 4 KB in total and this site's settings had
// reached it, so new non-secret IDs belong here. An environment variable
// of the same name still wins, for pointing a deploy at test copies.
const IDS = {
  MEDICAL_APPOINTMENTS_DB_ID: '389478b3-1169-4b1d-8dcb-abb37e621173',
  SPONSOR_CHECKLISTS_DB_ID: 'b633c24d-6692-42a4-98e9-e2194d8a2613',
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
  DSP_INTAKE_STAGES_DB_ID: 'aea99ef9-c40f-48fd-9746-122f7dfb5f02',
  DSP_INTAKE_STEPS_DB_ID: 'dcd857a2-5870-4bca-bdfd-14870badd538',
  SPONSOR_INTAKE_ROOT_FOLDER_ID: '1A3LrLbu_T2mn80FkKsmyjum0xWwCN3A8',
  TRAINING_REQUIREMENTS_DB_ID: '76cee555-d2ef-4561-9e64-b49596736dea',
  ISP_TRAINING_DB_ID: '163a7957-a3c6-4b67-8aad-a62d524f2525',
  // The ISP Training Acknowledgment JotForm (lib/isp-training.js).
  ISP_TRAINING_FORM_URL: 'https://form.jotform.com/263138851387062',
  ASRS_PEOPLE_DB_ID: 'd4b45ddb-cc42-4a50-8c07-a1df5501904d',
  STAFF_TRAINING_DB_ID: 'c5a94e47-d1a2-409e-8cd4-0cc9debf8ce6',
  DAILY_PROGRESS_NOTE_QUESTIONS_DB_ID: 'cb9f1f2f-d982-425a-92f8-496758529283',
  DAILY_PROGRESS_NOTES_DB_ID: 'd3c439da-f2ff-45cc-a265-0392568c1306',
  DAILY_PROGRESS_NOTE_ANSWERS_DB_ID: '4b98a8d0-af57-421a-a68b-9ace4b28a081',
  // Training Modules (Longstreet Dashboard / Training Modules in Notion)
  MODULES_DB_ID: 'f6eb1eb2-4cc0-424c-86d9-e29da4fa74da',
  MODULE_STEPS_DB_ID: '7ffcb163-43a5-4df4-bf5c-e7dcacc75da6',
  MODULE_ASSIGNMENTS_DB_ID: '423c9fc0-6339-4b14-b3e7-16150094c36c',
  MODULE_RESPONSES_DB_ID: 'ec21d714-34af-40e7-820a-a4b7c3339173',
  PATHS_DB_ID: '72dfc838-d9bc-4cf4-9d8c-d23f0720fe78',
  PATH_STEPS_DB_ID: '6119b077-c8bf-4819-8b29-358b915bf9cb',
  PATH_ASSIGNMENTS_DB_ID: '02b6083f-6255-47b2-a579-1930e3034bf4',
  LIAISON_VISITS_DB_ID: 'a9f3aeff-47ec-49df-b249-cc61c3de6ab0',
  VISIT_CHECKLIST_DB_ID: '30300019-3a67-40e8-b4ca-5d89d8a9a173',
  QUESTIONNAIRE_LINKS_DB_ID: 'd451cc84-043a-4c3a-b3a8-2fd9989fa889',
  QUESTIONNAIRE_RESPONSES_DB_ID: 'ff8e2740-cd3e-4ed1-8c64-fbbc801242f3',
  LIAISON_FLAGS_DB_ID: '66176460-c291-4d17-9837-6e17b96e127a',
  LOCATION_REPORTS_DB_ID: '11de07c2-d91a-46da-abbe-fa6e1c7dd1db',
  QI_RM_CHECKLISTS_DB_ID: '265e2ac5-b93c-426e-bc4f-1531b999bffe',
  LOCATION_CODES_DB_ID: '4bf686f3-056b-49c3-925c-a321a2c78591',
  // Catch Hook of the "asrs-vehicle-documents" Zapier workflow. Not a
  // secret: it's handed to the browser for the direct upload, and the
  // workflow trusts nothing but the encrypted ticket sent with the file.
  VEHICLE_DOCUMENT_WEBHOOK_URL: 'https://hooks.zapier.com/hooks/catch/27672979/kjm7wHbEamjVqlc4/',
  // Catch Hook of the "asrs-document-filing" Zapier workflow (Liaison app
  // visit and questionnaire PDFs into Drive). Not a secret: the workflow
  // trusts only the encrypted ticket sent with each file.
  DOCUMENT_FILING_WEBHOOK_URL: 'https://hooks.zapier.com/hooks/catch/27672979/Ce0hxzHOqlN0ZMfqq/',
  // A Google OAuth client ID is public by design (it's sent to browsers in
  // sign-in links); the client secret and refresh token stay in Netlify.
  GOOGLE_OAUTH_CLIENT_ID: '650411460927-99qvctvtjq2nc8883mmvr8ddgij850gh.apps.googleusercontent.com'
};

function id(name) {
  return process.env[name] || IDS[name];
}

module.exports = { id };
