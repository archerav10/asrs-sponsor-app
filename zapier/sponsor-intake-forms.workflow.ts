import { defineDurable } from "@zapier/zapier-durable";
import { createZapierSdk } from "@zapier/zapier-sdk";
import { z } from "zod";

// ASRS Sponsor Intake forms. Fires on a new JotForm submission. Every
// intake form link carries a hidden app_filename tracking value,
// Intake_{intakeId}_{step}_{signature}; the signature lets the app trust
// it without any secret living here. JotForm's Google Drive integration
// saves the submission PDF (named by submission ID) into a staging
// folder; this files it into Sponsor Intake/{Sponsor}/{n Stage}/ and
// tells the app the form came in.
//
// One copy of this workflow runs per intake form (a workflow has one
// trigger); the source is identical.

const sdk = createZapierSdk();

const DRIVE_APP_KEY = "GoogleDriveCLIAPI";
const DRIVE_CONNECTION = "google_drive";
const WEBHOOKS_APP_KEY = "WebHookCLIAPI";
const STAGING_FOLDER_ID = "13Lwic9c_nljgkk3TtU_g6oQ_Ig6gotns";
// Production first; the deploy preview until the app is merged. Both use
// the same Notion and Drive, so either one records the submission.
const SITES = [
  "https://asrs-sponsor-app.netlify.app",
  "https://deploy-preview-2--asrs-sponsor-app.netlify.app",
];
const TRACKING_RE = /Intake_[0-9a-fA-F]{32}_\d+-(?:\d+[a-z]?|A\d+)(?:_[0-9a-f]{16})?/;
const PDF_LOOKUPS = 10; // ~5 minutes for JotForm's Drive integration to save the PDF

const InputSchema = z.looseObject({});
type Input = z.infer<typeof InputSchema>;

const ResolvedSchema = z
  .object({
    rootFolderId: z.string(),
    sponsorFolderName: z.string(),
    stageFolderName: z.string(),
    filename: z.string(),
  })
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

function postTo(url: string, data: Record<string, string>) {
  return sdk.runAction({
    appKey: WEBHOOKS_APP_KEY,
    actionType: "write",
    actionKey: "post",
    inputs: { url, payload_type: "json", data },
  });
}

const workflow = defineDurable<Input, unknown>(
  "asrs-sponsor-intake-forms",
  async (ctx, rawInput) => {
    const input = InputSchema.parse(normalizeInput(rawInput)) as Record<string, unknown>;
    const tracking = findTracking(input);
    if (!tracking) {
      return { skipped: true, reason: "not-an-intake-submission" };
    }
    const submissionId = String(input.id ?? input.submissionID ?? input.submission_id ?? "");

    // Which site answers: production once merged, else the preview.
    let site = "";
    let dest: z.infer<typeof ResolvedSchema> | null = null;
    for (let i = 0; i < SITES.length && !dest; i++) {
      try {
        const resolved = await ctx.step({
          name: "resolve-destination-" + (i + 1),
          maxAttempts: i === SITES.length - 1 ? 5 : 1,
          retryDelaySeconds: 10,
          run: async () =>
            postTo(SITES[i] + "/.netlify/functions/sponsor-intake-resolve-upload", { filename: tracking }),
        });
        dest = ResolvedSchema.parse(resolved.data[0]);
        site = SITES[i];
      } catch (e) {
        if (i === SITES.length - 1) throw e;
      }
    }
    if (!dest) throw new Error("Could not resolve where this form goes.");
    const target = dest;

    // JotForm's Drive integration can lag the submission a little.
    let pdfId: string | undefined;
    if (submissionId) {
      for (let n = 1; n <= PDF_LOOKUPS && !pdfId; n++) {
        const found = await ctx.step("find-staged-pdf-" + n, async () =>
          sdk.runAction({
            appKey: DRIVE_APP_KEY,
            actionType: "search",
            actionKey: "file_v2",
            connection: DRIVE_CONNECTION,
            inputs: { title: submissionId, folder: STAGING_FOLDER_ID, search_type: "contains" },
          }),
        );
        pdfId = (found.data[0] as { id?: string } | undefined)?.id;
        if (!pdfId && n < PDF_LOOKUPS) await ctx.wait("wait-for-staged-pdf-" + n, 30);
      }
    }

    if (pdfId) {
      const sponsorFound = await ctx.step("find-sponsor-folder", async () =>
        sdk.runAction({
          appKey: DRIVE_APP_KEY,
          actionType: "search",
          actionKey: "folder_v2",
          connection: DRIVE_CONNECTION,
          inputs: { title: target.sponsorFolderName, folder: target.rootFolderId, search_type: "exact" },
        }),
      );
      let sponsorFolderId = (sponsorFound.data[0] as { id?: string } | undefined)?.id;
      if (!sponsorFolderId) {
        const created = await ctx.step("create-sponsor-folder", async () =>
          sdk.runAction({
            appKey: DRIVE_APP_KEY,
            actionType: "write",
            actionKey: "folder",
            connection: DRIVE_CONNECTION,
            inputs: { title: target.sponsorFolderName, folder: target.rootFolderId },
          }),
        );
        sponsorFolderId = (created.data[0] as { id?: string } | undefined)?.id;
      }
      if (!sponsorFolderId) throw new Error("Could not find or create the sponsor folder.");

      const stageFound = await ctx.step("find-stage-folder", async () =>
        sdk.runAction({
          appKey: DRIVE_APP_KEY,
          actionType: "search",
          actionKey: "folder_v2",
          connection: DRIVE_CONNECTION,
          inputs: { title: target.stageFolderName, folder: sponsorFolderId, search_type: "exact" },
        }),
      );
      let stageFolderId = (stageFound.data[0] as { id?: string } | undefined)?.id;
      if (!stageFolderId) {
        const created = await ctx.step("create-stage-folder", async () =>
          sdk.runAction({
            appKey: DRIVE_APP_KEY,
            actionType: "write",
            actionKey: "folder",
            connection: DRIVE_CONNECTION,
            inputs: { title: target.stageFolderName, folder: sponsorFolderId },
          }),
        );
        stageFolderId = (created.data[0] as { id?: string } | undefined)?.id;
      }
      if (!stageFolderId) throw new Error("Could not find or create the stage folder.");

      await ctx.step("move-pdf-to-stage-folder", async () =>
        sdk.runAction({
          appKey: DRIVE_APP_KEY,
          actionType: "write",
          actionKey: "move_file",
          connection: DRIVE_CONNECTION,
          inputs: { file: pdfId, folder: stageFolderId },
        }),
      );
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

    // Marks the item Received (or Complete for an ASRS step such as a
    // reference check) and emails the admins. Recorded even if the PDF
    // never showed up, so the submission isn't lost; the result says so.
    await ctx.step("mark-form-submitted", async () =>
      postTo(site + "/.netlify/functions/sponsor-intake-form-submitted", { filename: tracking }),
    );

    return { tracking, submissionId, filed: !!pdfId, filename: target.filename, site };
  },
);

export default workflow;
