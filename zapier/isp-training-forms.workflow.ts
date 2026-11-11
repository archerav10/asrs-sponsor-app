import { defineDurable } from "@zapier/zapier-durable";
import { createZapierSdk } from "@zapier/zapier-sdk";
import { z } from "zod";

// ASRS ISP Training Acknowledgment. Fires on a new JotForm submission.
// Every signing link the app makes carries a hidden app_filename tracking
// value, ISP_{staffId}_{resident}_{planDate}_{signature}; the signature
// lets the app trust it without any secret living here. JotForm's Google
// Drive integration saves the signed PDF, named by app_filename, into the
// staging folder (Completed Jotforms); this moves it into the staff
// member's Training folder under a name the app's Drive check recognizes,
// then tells the app who signed for which plan.

const sdk = createZapierSdk();

const DRIVE_APP_KEY = "GoogleDriveCLIAPI";
const DRIVE_CONNECTION = "google_drive";
const WEBHOOKS_APP_KEY = "WebHookCLIAPI";
const STAGING_FOLDER_ID = "13Lwic9c_nljgkk3TtU_g6oQ_Ig6gotns";
const SITE = "https://asrs-sponsor-app.netlify.app";
const TRACKING_RE = /ISP_[0-9a-f]{32}_[A-Za-z0-9]+_\d{8}_[0-9a-f]{16}/;

const InputSchema = z.looseObject({});
type Input = z.infer<typeof InputSchema>;

const ResolvedSchema = z
  .object({ folderId: z.string(), filename: z.string() })
  .loose();

function normalizeInput(rawInput: unknown): unknown {
  if (typeof rawInput === "string") return JSON.parse(rawInput);
  return rawInput;
}

// The tracking value can sit under any answer key, so search the whole
// submission for it.
function findTracking(value: unknown, depth = 0): string {
  if (depth > 6 || value == null) return "";
  if (typeof value === "string") return TRACKING_RE.exec(value)?.[0] ?? "";
  if (Array.isArray(value)) {
    for (const v of value) {
      const t = findTracking(v, depth + 1);
      if (t) return t;
    }
    return "";
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      const t = findTracking(v, depth + 1);
      if (t) return t;
    }
  }
  return "";
}

// The first answer whose key matches (e.g. "trainedBy", "Trained by (ASRS
// staff name)"), as text.
function findAnswer(value: unknown, keyRe: RegExp, depth = 0): string {
  if (depth > 6 || value == null || typeof value !== "object") return "";
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (keyRe.test(k) && v != null && typeof v !== "object") return String(v);
    if (keyRe.test(k) && v && typeof v === "object") {
      const parts = Object.values(v as Record<string, unknown>).filter((x) => typeof x === "string" || typeof x === "number");
      if (parts.length) return parts.join("-");
    }
  }
  for (const v of Object.values(value as Record<string, unknown>)) {
    const found = findAnswer(v, keyRe, depth + 1);
    if (found) return found;
  }
  return "";
}

const workflow = defineDurable<Input, unknown>(
  "asrs-isp-training-forms",
  async (ctx, rawInput) => {
    const input = InputSchema.parse(normalizeInput(rawInput)) as Record<string, unknown>;
    const tracking = findTracking(input);
    if (!tracking) {
      return { skipped: true, reason: "not-from-an-app-signing-link" };
    }
    const submissionId = String(input.id ?? input.submissionID ?? input.submission_id ?? "");
    const trainedBy = findAnswer(input, /trained.?by/i);
    const signedDate = findAnswer(input, /^(date|q\d+_date)$|(^|[^a-z])date$/i);

    const resolved = await ctx.step("resolve-destination", async () => {
      const res = await sdk.runAction({
        appKey: WEBHOOKS_APP_KEY,
        actionType: "write",
        actionKey: "post",
        inputs: { url: SITE + "/.netlify/functions/isp-training-resolve", payload_type: "json", data: { tracking } },
      });
      return res.data[0];
    });
    const target = ResolvedSchema.parse(resolved);

    // JotForm's Google Drive integration saves the PDF into the staging
    // folder within seconds, named from app_filename. The lookup throws
    // while it's missing, so the step retries.
    let pdfId: string | undefined;
    await ctx.wait("wait-for-staged-pdf", 20);
    try {
      const found = await ctx.step("find-staged-pdf", async () => {
        const byTracking = await sdk.runAction({
          appKey: DRIVE_APP_KEY,
          actionType: "search",
          actionKey: "file_v2",
          connection: DRIVE_CONNECTION,
          inputs: { title: tracking, folder: STAGING_FOLDER_ID, search_type: "contains" },
        });
        if (byTracking.data[0]) return byTracking;
        if (submissionId) {
          const byId = await sdk.runAction({
            appKey: DRIVE_APP_KEY,
            actionType: "search",
            actionKey: "file_v2",
            connection: DRIVE_CONNECTION,
            inputs: { title: submissionId, folder: STAGING_FOLDER_ID, search_type: "contains" },
          });
          if (byId.data[0]) return byId;
        }
        throw new Error("Signed PDF not in the staging folder yet.");
      });
      pdfId = (found.data[0] as { id?: string } | undefined)?.id;
    } catch (e) {
      pdfId = undefined; // record the training anyway, below
    }

    if (pdfId) {
      // No Training folder yet: the PDF stays in the staging folder, renamed.
      if (target.folderId) {
        await ctx.step("move-pdf-to-training-folder", async () =>
          sdk.runAction({
            appKey: DRIVE_APP_KEY,
            actionType: "write",
            actionKey: "move_file",
            connection: DRIVE_CONNECTION,
            inputs: { file: pdfId, folder: target.folderId },
          }),
        );
      }
      await ctx.step("rename-pdf", async () =>
        sdk.runAction({
          appKey: DRIVE_APP_KEY,
          actionType: "write",
          actionKey: "update_file_name",
          connection: DRIVE_CONNECTION,
          inputs: { file: pdfId, new_name: target.filename },
        }),
      );
    }

    await ctx.step("record-training", async () =>
      sdk.runAction({
        appKey: WEBHOOKS_APP_KEY,
        actionType: "write",
        actionKey: "post",
        inputs: {
          url: SITE + "/.netlify/functions/isp-training-submitted",
          payload_type: "json",
          data: { tracking, trainedBy, signedDate, fileId: pdfId ?? "", filename: pdfId ? target.filename : "" },
        },
      }),
    );

    return { tracking, submissionId, filed: !!pdfId, inTrainingFolder: !!(pdfId && target.folderId), filename: target.filename };
  },
);

export default workflow;
