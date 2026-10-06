import { defineDurable } from "@zapier/zapier-durable";
import { createZapierSdk } from "@zapier/zapier-sdk";
import { z } from "zod";

// ASRS Sponsor Intake uploads. The upload page (sponsor) and the admin
// dashboard POST each file here as multipart form data with:
//   file, ticket, part, total, ext, site
// The ticket is an encrypted, 2-hour pass naming the intake and step; the
// app trades it for the sponsor/stage folder names and the final filename.
// The file then lands in Sponsor Intake/{Sponsor}/{n Stage}/ in Drive.

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
    part: z.union([z.string(), z.number()]).nullable().optional(),
    total: z.union([z.string(), z.number()]).nullable().optional(),
    ext: z.string().nullable().optional(),
    site: z.string().nullable().optional(),
  })
  .loose();
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

const workflow = defineDurable<Input, unknown>(
  "asrs-sponsor-intake-uploads",
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
    const part = Number(input.part ?? 1) || 1;

    // Multi-file uploads arrive as parallel runs. Let part 1 create any
    // missing folders before the others look for them.
    if (part > 1) {
      await ctx.wait("let-first-part-create-folders", Math.min(part - 1, 10) * 20);
    }

    // Webhooks by Zapier rather than fetch: the workflow sandbox can't
    // reach outside hosts directly. A rejected ticket throws here.
    const resolved = await ctx.step("resolve-destination", async () =>
      sdk.runAction({
        appKey: WEBHOOKS_APP_KEY,
        actionType: "write",
        actionKey: "post",
        inputs: {
          url: site + "/.netlify/functions/sponsor-intake-resolve-upload",
          payload_type: "json",
          data: {
            ticket: input.ticket,
            part: String(input.part ?? 1),
            total: String(input.total ?? 1),
            ext: input.ext ?? "",
          },
        },
      }),
    );
    const dest = ResolvedSchema.parse(resolved.data[0]);

    const sponsorFound = await ctx.step("find-sponsor-folder", async () =>
      sdk.runAction({
        appKey: DRIVE_APP_KEY,
        actionType: "search",
        actionKey: "folder_v2",
        connection: DRIVE_CONNECTION,
        inputs: { title: dest.sponsorFolderName, folder: dest.rootFolderId, search_type: "exact" },
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
          inputs: { title: dest.sponsorFolderName, folder: dest.rootFolderId },
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
        inputs: { title: dest.stageFolderName, folder: sponsorFolderId, search_type: "exact" },
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
          inputs: { title: dest.stageFolderName, folder: sponsorFolderId },
        }),
      );
      stageFolderId = (created.data[0] as { id?: string } | undefined)?.id;
    }
    if (!stageFolderId) throw new Error("Could not find or create the stage folder.");

    // "1.3 Photo ID - Maria Lopez - 2026-09-24.jpg" -> name + extension
    const m = /^(.*)\.([A-Za-z0-9]{1,5})$/.exec(dest.filename);
    const uploadInputs: Record<string, unknown> = { file, folder: stageFolderId, new_name: m ? m[1] : dest.filename };
    if (m) uploadInputs.new_extension = m[2];

    const uploaded = await ctx.step("upload-file-to-stage-folder", async () =>
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
