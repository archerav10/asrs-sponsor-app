import { defineDurable } from "@zapier/zapier-durable";
import { createZapierSdk } from "@zapier/zapier-sdk";
import { z } from "zod";

// ASRS Module Certificates. When someone submits a training module, the
// Sponsor App (module-submit -> lib/training-modules.js) POSTs the
// certificate PDF here as multipart form data with:
//   file, assignmentId, certificateId, site
// Nothing in the post but the file is trusted: the app is asked
// (module-certificate-resolve) where it goes and what it's called, and it
// only answers for a Completed assignment with that Certificate ID. The
// PDF lands in the person's Training folder, or, when none is set, in
//   Facility Reporting/{Location}/Module Certificates/
// (created on first use; the location folder must already exist). Last,
// the app is told the file is saved, which sets Certificate Status = Saved.

const sdk = createZapierSdk();

const DRIVE_APP_KEY = "GoogleDriveCLIAPI";
const DRIVE_CONNECTION = "google_drive";
const WEBHOOKS_APP_KEY = "WebHookCLIAPI";

// Only the ASRS sponsor app (production or a deploy preview) is trusted.
const SITE_RE = /^https:\/\/([a-z0-9-]+--)?asrs-sponsor-app\.netlify\.app$/;

const InputSchema = z
  .object({
    file: z.unknown().nullable().optional(),
    assignmentId: z.string().nullable().optional(),
    certificateId: z.string().nullable().optional(),
    site: z.string().nullable().optional(),
  })
  .loose();
type Input = z.infer<typeof InputSchema>;

const ResolvedSchema = z
  .object({
    filename: z.string(),
    folderId: z.string().nullable().optional(),
    rootFolderId: z.string(),
    locationFolderName: z.string(),
    fallbackFolderName: z.string(),
  })
  .loose();

function normalizeInput(rawInput: unknown): unknown {
  if (typeof rawInput === "string") return JSON.parse(rawInput);
  return rawInput;
}

// A Catch Hook hands file parts over as a URL to the stored file; accept
// either that string or an object carrying one.
function fileUrl(file: unknown): string {
  if (typeof file === "string") return file;
  if (file && typeof file === "object") {
    const f = file as Record<string, unknown>;
    for (const key of ["url", "href", "file", "link"]) {
      if (typeof f[key] === "string") return f[key] as string;
    }
  }
  return "";
}

function firstId(result: { data: unknown[] }): string | undefined {
  return (result.data[0] as { id?: string } | undefined)?.id;
}

const workflow = defineDurable<Input, unknown>(
  "asrs-module-certificates",
  async (ctx, rawInput) => {
    const input = InputSchema.parse(normalizeInput(rawInput));
    const site = (input.site ?? "https://asrs-sponsor-app.netlify.app").replace(/\/+$/, "");
    if (!SITE_RE.test(site)) {
      return { skipped: true, reason: "untrusted-site", site };
    }
    const file = fileUrl(input.file);
    const assignmentId = input.assignmentId ?? "";
    const certificateId = input.certificateId ?? "";
    if (!file || !assignmentId || !certificateId) {
      return { skipped: true, reason: "missing-fields", hasFile: !!file, hasAssignment: !!assignmentId, hasCertificate: !!certificateId };
    }

    // Webhooks by Zapier rather than fetch: the workflow sandbox can't
    // reach outside hosts directly. An unknown certificate throws here.
    const resolved = await ctx.step("resolve-destination", async () =>
      sdk.runAction({
        appKey: WEBHOOKS_APP_KEY,
        actionType: "write",
        actionKey: "post",
        inputs: {
          url: site + "/.netlify/functions/module-certificate-resolve",
          payload_type: "json",
          data: { action: "resolve", assignmentId, certificateId },
        },
      }),
    );
    const dest = ResolvedSchema.parse(resolved.data[0]);

    let folderId = dest.folderId ?? "";
    if (!folderId) {
      const locationFound = await ctx.step("find-location-folder", async () =>
        sdk.runAction({
          appKey: DRIVE_APP_KEY,
          actionType: "search",
          actionKey: "folder_v2",
          connection: DRIVE_CONNECTION,
          inputs: { title: dest.locationFolderName, folder: dest.rootFolderId, search_type: "exact" },
        }),
      );
      const locationFolderId = firstId(locationFound);
      if (!locationFolderId) throw new Error(`No "${dest.locationFolderName}" folder in Facility Reporting.`);

      const certsFound = await ctx.step("find-certificates-folder", async () =>
        sdk.runAction({
          appKey: DRIVE_APP_KEY,
          actionType: "search",
          actionKey: "folder_v2",
          connection: DRIVE_CONNECTION,
          inputs: { title: dest.fallbackFolderName, folder: locationFolderId, search_type: "exact" },
        }),
      );
      folderId = firstId(certsFound) ?? "";
      if (!folderId) {
        const created = await ctx.step("create-certificates-folder", async () =>
          sdk.runAction({
            appKey: DRIVE_APP_KEY,
            actionType: "write",
            actionKey: "folder",
            connection: DRIVE_CONNECTION,
            inputs: { title: dest.fallbackFolderName, folder: locationFolderId },
          }),
        );
        folderId = firstId(created) ?? "";
      }
      if (!folderId) throw new Error("Could not find or create the Module Certificates folder.");
    }

    // "Module_HEADSUP1_Jordan-Ellis_2026-11-05.pdf" -> name + extension
    const m = /^(.*)\.([A-Za-z0-9]{1,5})$/.exec(dest.filename);
    const uploadInputs: Record<string, unknown> = { file, folder: folderId, new_name: m ? m[1] : dest.filename };
    if (m) uploadInputs.new_extension = m[2];

    const uploaded = await ctx.step("upload-certificate", async () =>
      sdk.runAction({
        appKey: DRIVE_APP_KEY,
        actionType: "write",
        actionKey: "file",
        connection: DRIVE_CONNECTION,
        inputs: uploadInputs,
      }),
    );
    const out = uploaded.data[0] as { id?: string; alternateLink?: string } | undefined;

    await ctx.step("confirm-saved", async () =>
      sdk.runAction({
        appKey: WEBHOOKS_APP_KEY,
        actionType: "write",
        actionKey: "post",
        inputs: {
          url: site + "/.netlify/functions/module-certificate-resolve",
          payload_type: "json",
          data: { action: "saved", assignmentId, certificateId, link: out?.alternateLink ?? "" },
        },
      }),
    );

    return { filename: dest.filename, fileId: out?.id ?? null, link: out?.alternateLink ?? null };
  },
);

export default workflow;
