import { defineDurable } from "@zapier/zapier-durable";
import { createZapierSdk } from "@zapier/zapier-sdk";
import { z } from "zod";

// ASRS Questionnaires. Every questionnaire Jotform (resident interview,
// sponsor and DSP questionnaires, and any per-home copies) has a webhook
// pointing at this workflow's Catch Hook. Jotform posts formID,
// submissionID, formTitle, rawRequest (the answers, keyed by field) and
// pretty (a "Label:Answer, ..." summary).
//
// The workflow reads the submission from Jotform's API to get each
// answer with its question label (falling back to the webhook's own data),
// finds the signed app_tracking value the Liaison app put in the link,
// and posts everything to /questionnaire-submitted. The app checks the
// signature, records the response once, and files the PDF in Drive.
// Submissions the app can't tie to a link it opened are skipped there.

const sdk = createZapierSdk();

const JOTFORM_APP_KEY = "JotFormCLIAPI";
const JOTFORM_CONNECTION = "jotform";
const WEBHOOKS_APP_KEY = "WebHookCLIAPI";
const APP_SITE = "https://asrs-sponsor-app.netlify.app";
const TRACKING_RE = /Q1\.[A-Za-z0-9_-]+\.[0-9a-f]{24}/;
const SKIP_TYPES = new Set(["control_head", "control_button", "control_text", "control_pagebreak", "control_collapse", "control_divider", "control_image"]);

const InputSchema = z.looseObject({});
type Input = z.infer<typeof InputSchema>;

function normalizeInput(rawInput: unknown): Record<string, unknown> {
  if (typeof rawInput === "string") return JSON.parse(rawInput);
  return (rawInput ?? {}) as Record<string, unknown>;
}

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(str).filter(Boolean).join(", ");
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).map(str).filter(Boolean).join(" ");
  return "";
}

function findTracking(value: unknown, depth = 0): string {
  if (depth > 6 || value == null) return "";
  if (typeof value === "string") return TRACKING_RE.exec(value)?.[0] ?? "";
  if (Array.isArray(value)) {
    for (const v of value) { const t = findTracking(v, depth + 1); if (t) return t; }
    return "";
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) { const t = findTracking(v, depth + 1); if (t) return t; }
  }
  return "";
}

type Answer = { question: string; answer: string };

// Jotform API submission: content.answers = { qid: { text, type, order, answer, prettyFormat, name } }
function answersFromApi(content: Record<string, unknown>): Answer[] {
  const answers = (content.answers ?? {}) as Record<string, Record<string, unknown>>;
  return Object.values(answers)
    .filter((a) => a && !SKIP_TYPES.has(String(a.type)) && String(a.name) !== "app_tracking" && !TRACKING_RE.test(str(a.answer)))
    .sort((a, b) => Number(a.order) - Number(b.order))
    .map((a) => ({ question: str(a.text), answer: str(a.prettyFormat ?? a.answer) }))
    .filter((a) => a.question);
}

// Fallback: the webhook's "pretty" summary, "Label:Answer, Label:Answer".
function answersFromPretty(pretty: string): Answer[] {
  return pretty.split(/,\s(?=[^,:]{2,120}:)/).map((part) => {
    const i = part.indexOf(":");
    return i > 0 ? { question: part.slice(0, i).trim(), answer: part.slice(i + 1).trim() } : { question: part.trim(), answer: "" };
  }).filter((a) => a.question && !TRACKING_RE.test(a.answer));
}

const workflow = defineDurable<Input, unknown>(
  "asrs-questionnaires",
  async (ctx, rawInput) => {
    const input = normalizeInput(rawInput);
    let raw: unknown = input.rawRequest;
    if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { /* keep string */ } }
    // The tracking value can come back empty (a form whose hidden field
    // has a different name); the app then matches the submission to the
    // link it opened for this form, so it is posted either way.
    const tracking = findTracking(raw) || findTracking(input);

    const formId = str(input.formID ?? input.formId);
    const submissionId = str(input.submissionID ?? input.submissionId);
    if (!submissionId) return { skipped: true, reason: "no-submission-id" };
    if (!tracking && !formId) return { skipped: true, reason: "no-tracking-or-form" };

    // Fetching and parsing both happen inside the step so a replay reuses
    // the result. A blank submittedAt lets the app use its own clock.
    const fromApi = await ctx.step("get-submission", async () => {
      try {
        const fetched = await sdk.runAction({
          appKey: JOTFORM_APP_KEY,
          actionType: "write",
          actionKey: "_zap_raw_request",
          connection: JOTFORM_CONNECTION,
          inputs: { url: `https://api.jotform.com/submission/${submissionId}`, fail_on_errors: "true" },
        });
        const rec = fetched.data[0] as Record<string, unknown> | undefined;
        const bodyRaw = rec?.response && typeof rec.response === "object" ? (rec.response as Record<string, unknown>).content ?? rec.response : rec?.content ?? rec;
        const content = (typeof bodyRaw === "string" ? JSON.parse(bodyRaw) : bodyRaw) as Record<string, unknown>;
        const inner = (content?.content ?? content) as Record<string, unknown>;
        const created = typeof inner.created_at === "string" ? inner.created_at.replace(" ", "T") + "-05:00" : "";
        return { answers: answersFromApi(inner), submittedAt: created };
      } catch {
        return { answers: [] as Answer[], submittedAt: "" };
      }
    });
    let answers: Answer[] = fromApi.answers;
    const submittedAt = fromApi.submittedAt;
    if (!answers.length) answers = answersFromPretty(str(input.pretty));

    const posted = await ctx.step("record-in-app", async () =>
      sdk.runAction({
        appKey: WEBHOOKS_APP_KEY,
        actionType: "write",
        actionKey: "post",
        inputs: {
          url: APP_SITE + "/.netlify/functions/questionnaire-submitted",
          payload_type: "json",
          data: { tracking, formId, formTitle: str(input.formTitle), submissionId, submittedAt, answers: JSON.stringify(answers) },
        },
      }),
    );
    return { submissionId, answers: answers.length, app: posted.data[0] ?? null };
  },
);

export default workflow;
