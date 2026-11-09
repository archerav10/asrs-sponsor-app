import { defineDurable } from "@zapier/zapier-durable";
import { createZapierSdk } from "@zapier/zapier-sdk";
import { z } from "zod";

// ASRS Vehicle Documents (normally the insurance declarations page). The
// admin dashboard and the sponsor app POST each file here as multipart
// form data with:
//   file, ticket, site
// The ticket is an encrypted, 2-hour pass naming one vehicle service entry
// and file; the app trades it for the folder names and the final filename.
// The file lands in
//   Facility Reporting/{Location}/Vehicles/
// The location folder must already exist (a missing one should surface as
// an error, not quietly create a stray folder); Vehicles is created on
// first use. Once saved, the app is told, which sets Document Status =
// Saved on the entry.

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
    vehiclesFolderName: z.string(),
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
  "asrs-vehicle-documents",
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
    const resolveUrl = site + "/.netlify/functions/vehicle-document-resolve";

    // Webhooks by Zapier rather than fetch: the workflow sandbox can't
    // reach outside hosts directly. A rejected ticket throws here.
    const resolved = await ctx.step("resolve-destination", async () =>
      sdk.runAction({
        appKey: WEBHOOKS_APP_KEY,
        actionType: "write",
        actionKey: "post",
        inputs: { url: resolveUrl, payload_type: "json", data: { action: "resolve", ticket: input.ticket } },
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

    const vehiclesFound = await ctx.step("find-vehicles-folder", async () =>
      sdk.runAction({
        appKey: DRIVE_APP_KEY,
        actionType: "search",
        actionKey: "folder_v2",
        connection: DRIVE_CONNECTION,
        inputs: { title: dest.vehiclesFolderName, folder: locationFolderId, search_type: "exact" },
      }),
    );
    let vehiclesFolderId = firstId(vehiclesFound);
    if (!vehiclesFolderId) {
      const created = await ctx.step("create-vehicles-folder", async () =>
        sdk.runAction({
          appKey: DRIVE_APP_KEY,
          actionType: "write",
          actionKey: "folder",
          connection: DRIVE_CONNECTION,
          inputs: { title: dest.vehiclesFolderName, folder: locationFolderId },
        }),
      );
      vehiclesFolderId = firstId(created);
    }
    if (!vehiclesFolderId) throw new Error("Could not find or create the Vehicles folder.");

    // "2026-11-09_Janeway_BlueDodgeVan_InsuranceDecPage.pdf" -> name + extension
    const m = /^(.*)\.([A-Za-z0-9]{1,5})$/.exec(dest.filename);
    const uploadInputs: Record<string, unknown> = { file, folder: vehiclesFolderId, new_name: m ? m[1] : dest.filename };
    if (m) uploadInputs.new_extension = m[2];

    const uploaded = await ctx.step("upload-file-to-vehicles-folder", async () =>
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
        inputs: { url: resolveUrl, payload_type: "json", data: { action: "saved", ticket: input.ticket, link: out?.alternateLink ?? "" } },
      }),
    );

    return { filename: dest.filename, fileId: out?.id ?? null, link: out?.alternateLink ?? null };
  },
);

export default workflow;
