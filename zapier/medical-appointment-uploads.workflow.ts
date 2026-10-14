import { defineDurable } from "@zapier/zapier-durable";
import { createZapierSdk } from "@zapier/zapier-sdk";
import { z } from "zod";

// ASRS Medical Appointments uploads. The admin dashboard's Medical tab
// POSTs each document here as multipart form data with:
//   file, ticket, site
// The ticket is an encrypted, 2-hour pass naming the resident and file;
// the app trades it for the folder names and the final filename. The file
// then lands in
//   Facility Reporting/{Location}/Residents/{Full Name}/Medical Appointments/
// The location, Residents and resident folders must already exist (a
// typo'd or missing one should surface as an error, not quietly create a
// stray folder); Medical Appointments is created on first use.

const sdk = createZapierSdk();

const DRIVE_APP_KEY = "GoogleDriveCLIAPI";
const DRIVE_CONNECTION = "google_drive";
const WEBHOOKS_APP_KEY = "WebHookCLIAPI";

// Only the ASRS sponsor app (production or a deploy preview) is trusted
// to resolve tickets.
const SITE_RE = /^https:\/\/([a-z0-9-]+--)?asrs-sponsor-app\.netlify\.app$/;

const InputSchema = z
  .object({
    file: z.unknown().nullable().optional(),
    ticket: z.string(),
    site: z.string().nullable().optional(),
  })
  .loose();
type Input = z.infer<typeof InputSchema>;

const ResolvedSchema = z
  .object({
    rootFolderId: z.string(),
    locationFolderName: z.string(),
    residentFolderName: z.string(),
    medicalFolderName: z.string(),
    filename: z.string(),
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
  "asrs-medical-appointment-uploads",
  async (ctx, rawInput) => {
    const input = InputSchema.parse(normalizeInput(rawInput));
    const site = (input.site ?? "https://asrs-sponsor-app.netlify.app").replace(/\/+$/, "");
    if (!SITE_RE.test(site)) {
      return { skipped: true, reason: "untrusted-site", site };
    }
    const file = fileUrl(input.file);
    if (!file) {
      return { skipped: true, reason: "no-file", fileType: typeof input.file };
    }

    // Webhooks by Zapier rather than fetch: the workflow sandbox can't
    // reach outside hosts directly. A rejected ticket throws here.
    const resolved = await ctx.step("resolve-destination", async () =>
      sdk.runAction({
        appKey: WEBHOOKS_APP_KEY,
        actionType: "write",
        actionKey: "post",
        inputs: {
          url: site + "/.netlify/functions/medical-appointment-resolve-upload",
          payload_type: "json",
          data: { ticket: input.ticket },
        },
      }),
    );
    const dest = ResolvedSchema.parse(resolved.data[0]);

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

    const residentsFound = await ctx.step("find-residents-folder", async () =>
      sdk.runAction({
        appKey: DRIVE_APP_KEY,
        actionType: "search",
        actionKey: "folder_v2",
        connection: DRIVE_CONNECTION,
        inputs: { title: "Residents", folder: locationFolderId, search_type: "exact" },
      }),
    );
    const residentsFolderId = firstId(residentsFound);
    if (!residentsFolderId) throw new Error(`No "Residents" folder in ${dest.locationFolderName}.`);

    const residentFound = await ctx.step("find-resident-folder", async () =>
      sdk.runAction({
        appKey: DRIVE_APP_KEY,
        actionType: "search",
        actionKey: "folder_v2",
        connection: DRIVE_CONNECTION,
        inputs: { title: dest.residentFolderName, folder: residentsFolderId, search_type: "exact" },
      }),
    );
    const residentFolderId = firstId(residentFound);
    if (!residentFolderId) {
      throw new Error(`No "${dest.residentFolderName}" folder in ${dest.locationFolderName}/Residents.`);
    }

    const medicalFound = await ctx.step("find-medical-folder", async () =>
      sdk.runAction({
        appKey: DRIVE_APP_KEY,
        actionType: "search",
        actionKey: "folder_v2",
        connection: DRIVE_CONNECTION,
        inputs: { title: dest.medicalFolderName, folder: residentFolderId, search_type: "exact" },
      }),
    );
    let medicalFolderId = firstId(medicalFound);
    if (!medicalFolderId) {
      const created = await ctx.step("create-medical-folder", async () =>
        sdk.runAction({
          appKey: DRIVE_APP_KEY,
          actionType: "write",
          actionKey: "folder",
          connection: DRIVE_CONNECTION,
          inputs: { title: dest.medicalFolderName, folder: residentFolderId },
        }),
      );
      medicalFolderId = firstId(created);
    }
    if (!medicalFolderId) throw new Error("Could not find or create the Medical Appointments folder.");

    // "2026-10-01_Medical_TBTest_Janeway_AR.pdf" -> name + extension
    const m = /^(.*)\.([A-Za-z0-9]{1,5})$/.exec(dest.filename);
    const uploadInputs: Record<string, unknown> = { file, folder: medicalFolderId, new_name: m ? m[1] : dest.filename };
    if (m) uploadInputs.new_extension = m[2];

    const uploaded = await ctx.step("upload-file-to-medical-folder", async () =>
      sdk.runAction({
        appKey: DRIVE_APP_KEY,
        actionType: "write",
        actionKey: "file",
        connection: DRIVE_CONNECTION,
        inputs: uploadInputs,
      }),
    );

    const out = uploaded.data[0] as { id?: string; alternateLink?: string } | undefined;
    return { filename: dest.filename, fileId: out?.id ?? null, link: out?.alternateLink ?? null };
  },
);

export default workflow;
