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
const PRODUCTION_SITE = "https://asrs-sponsor-app.netlify.app";
const PREVIEW_SITE = "https://deploy-preview-2--asrs-sponsor-app.netlify.app";
const TRACKING_RE = /Intake_[0-9a-fA-F]{32}_\d+-(?:\d+[a-z]?|A\d+)(?:_[0-9a-f]{16})?/;

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
    const resolved = await ctx.step("resolve-destination", async () => {
      try {
        const res = await sdk.runAction({
          appKey: WEBHOOKS_APP_KEY,
          actionType: "write",
          actionKey: "post",
          inputs: {
            url: PRODUCTION_SITE + "/.netlify/functions/sponsor-intake-resolve-upload",
            payload_type: "json",
            data: { filename: tracking },
          },
        });
        return { site: PRODUCTION_SITE, dest: res.data[0] };
      } catch (e) {
        const res = await sdk.runAction({
          appKey: WEBHOOKS_APP_KEY,
          actionType: "write",
          actionKey: "post",
          inputs: {
            url: PREVIEW_SITE + "/.netlify/functions/sponsor-intake-resolve-upload",
            payload_type: "json",
            data: { filename: tracking },
          },
        });
        return { site: PREVIEW_SITE, dest: res.data[0] };
      }
    });
    const site = resolved.site;
    const target = ResolvedSchema.parse(resolved.dest);

    // JotForm's Drive integration saves the PDF (named by submission ID)
    // shortly after the submission. Give it a minute, then look; the
    // lookup throws while it's missing, so the step retries.
    let pdfId: string | undefined;
    if (submissionId) {
      await ctx.wait("wait-for-staged-pdf", 60);
      try {
        const found = await ctx.step("find-staged-pdf", async () => {
          const res = await sdk.runAction({
            appKey: DRIVE_APP_KEY,
            actionType: "search",
            actionKey: "file_v2",
            connection: DRIVE_CONNECTION,
            inputs: { title: submissionId, folder: STAGING_FOLDER_ID, search_type: "contains" },
          });
          if (!res.data[0]) throw new Error("Submission PDF not in the staging folder yet.");
          return res;
        });
        pdfId = (found.data[0] as { id?: string } | undefined)?.id;
      } catch (e) {
        pdfId = undefined; // record the submission anyway, below
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
      sdk.runAction({
        appKey: WEBHOOKS_APP_KEY,
        actionType: "write",
        actionKey: "post",
        inputs: {
          url: site + "/.netlify/functions/sponsor-intake-form-submitted",
          payload_type: "json",
          data: { filename: tracking },
        },
      }),
    );

    return { tracking, submissionId, filed: !!pdfId, filename: target.filename, site };
  },
);

export default workflow;
