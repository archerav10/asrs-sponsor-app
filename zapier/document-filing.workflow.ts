import { defineDurable } from "@zapier/zapier-durable";
import { createZapierSdk } from "@zapier/zapier-sdk";
import { z } from "zod";

// ASRS Document Filing (Liaison app visit and questionnaire PDFs). The app
// POSTs each PDF here as multipart form data with:
//   file, ticket, site
// The ticket is encrypted by the app and names the destination; the
// workflow trades it for the folder path and filename at
// /document-filing-resolve, then files the PDF under
//   Facility Reporting/{folders...}/
// A folder marked create: false must already exist (a typo'd or missing
// location or resident folder should surface as an error, not quietly make
// a stray folder); create: true folders are made on first use. Last, the
// app is told the file is saved, which sets PDF Status = Saved.

const sdk = createZapierSdk();

const DRIVE_APP_KEY = "GoogleDriveCLIAPI";
const DRIVE_CONNECTION = "google_drive";
const WEBHOOKS_APP_KEY = "WebHookCLIAPI";

// Only the ASRS sponsor app (production or a deploy preview) is trusted.
const SITE_RE = /^https:\/\/([a-z0-9-]+--)?asrs-sponsor-app\.netlify\.app$/;

const InputSchema = z
  .object({
    file: z.unknown().nullable().optional(),
    ticket: z.string().nullable().optional(),
    site: z.string().nullable().optional(),
  })
  .loose();
type Input = z.infer<typeof InputSchema>;

const ResolvedSchema = z
  .object({
    rootFolderId: z.string(),
    folders: z.array(z.object({ name: z.string(), create: z.boolean() }).loose()).min(1),
    filename: z.string(),
  })
  .loose();

function normalizeInput(rawInput: unknown): unknown {
  if (typeof rawInput === "string") return JSON.parse(rawInput);
  return rawInput;
}

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
  "asrs-document-filing",
  async (ctx, rawInput) => {
    const input = InputSchema.parse(normalizeInput(rawInput));
    // An empty or test request (no ticket) is skipped, not an error.
    if (!input.ticket) return { skipped: true, reason: "no-ticket" };
    const ticket = input.ticket;
    const site = (input.site ?? "https://asrs-sponsor-app.netlify.app").replace(/\/+$/, "");
    if (!SITE_RE.test(site)) return { skipped: true, reason: "untrusted-site", site };
    const file = fileUrl(input.file);
    if (!file) return { skipped: true, reason: "no-file", fileType: typeof input.file };
    const resolveUrl = site + "/.netlify/functions/document-filing-resolve";

    const resolved = await ctx.step("resolve-destination", async () =>
      sdk.runAction({
        appKey: WEBHOOKS_APP_KEY,
        actionType: "write",
        actionKey: "post",
        inputs: { url: resolveUrl, payload_type: "json", data: { action: "resolve", ticket } },
      }),
    );
    const dest = ResolvedSchema.parse(resolved.data[0]);

    let parentId = dest.rootFolderId;
    for (let i = 0; i < dest.folders.length; i++) {
      const folder = dest.folders[i];
      const parent = parentId;
      const found = await ctx.step(`find-folder-${i}`, async () =>
        sdk.runAction({
          appKey: DRIVE_APP_KEY,
          actionType: "search",
          actionKey: "folder_v2",
          connection: DRIVE_CONNECTION,
          inputs: { title: folder.name, folder: parent, search_type: "exact" },
        }),
      );
      let id = firstId(found);
      if (!id) {
        if (!folder.create) throw new Error(`No "${folder.name}" folder where it was expected (step ${i + 1} of ${dest.folders.map((f) => f.name).join("/")}).`);
        const created = await ctx.step(`create-folder-${i}`, async () =>
          sdk.runAction({
            appKey: DRIVE_APP_KEY,
            actionType: "write",
            actionKey: "folder",
            connection: DRIVE_CONNECTION,
            inputs: { title: folder.name, folder: parent },
          }),
        );
        id = firstId(created);
      }
      if (!id) throw new Error(`Could not find or create the "${folder.name}" folder.`);
      parentId = id;
    }

    const m = /^(.*)\.([A-Za-z0-9]{1,5})$/.exec(dest.filename);
    const uploadInputs: Record<string, unknown> = { file, folder: parentId, new_name: m ? m[1] : dest.filename };
    if (m) uploadInputs.new_extension = m[2];

    const uploaded = await ctx.step("upload-file", async () =>
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
        inputs: { url: resolveUrl, payload_type: "json", data: { action: "saved", ticket, link: out?.alternateLink ?? "" } },
      }),
    );

    return { filename: dest.filename, fileId: out?.id ?? null, link: out?.alternateLink ?? null };
  },
);

export default workflow;
