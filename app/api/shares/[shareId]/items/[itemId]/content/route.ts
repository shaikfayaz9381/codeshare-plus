import { route } from "@/lib/http/responses";
import { getAccessContext } from "@/lib/services/context";
import { requireReadableShare } from "@/lib/services/shares";
import { getItemForShare } from "@/lib/services/items";
import { classifyStoredFile } from "@/lib/uploads/file-types";
import { getStorage } from "@/lib/storage";
import { LocalStorageDriver } from "@/lib/storage/local";
import { streamSignedObject } from "@/lib/storage/signed-response";
import { sanitizeFilename } from "@/lib/security/filenames";
import { forbidden } from "@/lib/errors";
import type { ShareItemRow } from "@/lib/db/rows";

export const dynamic = "force-dynamic";

/**
 * GET /api/shares/[shareId]/items/[itemId]/content
 *
 * Authorized byte access:
 *  - file items  -> inline preview (raster image / PDF / audio / video) or
 *                   attachment download; gated by `allow_download`
 *  - code/text   -> raw text (used for downloads; the viewer's copy action uses
 *                   the item endpoint instead)
 *
 * Storage keys are never exposed. Inline previews always stream through this
 * handler (Range supported, so PDF viewers and media players can seek) and
 * stay same-origin, which the page CSP requires. Attachment downloads may
 * redirect to a short-lived (60 s) signed URL when the driver supports it.
 */

const EXTENSION_BY_LANGUAGE: Record<string, string> = {
  plaintext: "txt",
  javascript: "js",
  typescript: "ts",
  jsx: "jsx",
  tsx: "tsx",
  python: "py",
  java: "java",
  c: "c",
  cpp: "cpp",
  csharp: "cs",
  go: "go",
  rust: "rs",
  php: "php",
  html: "html",
  css: "css",
  json: "json",
  sql: "sql",
  bash: "sh",
  yaml: "yaml",
  markdown: "md",
};

function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "invalid";
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return "invalid";
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return "invalid";
    const start = Math.max(0, size - suffix);
    return { start, end: size - 1 };
  }
  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= size) return "invalid";
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isFinite(end) || end < start) return "invalid";
  return { start, end };
}

function contentDisposition(disposition: "inline" | "attachment", filename: string): string {
  const safe = sanitizeFilename(filename, "file");
  const fallback = safe.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function textFileName(item: ShareItemRow): string {
  if (item.original_filename) return item.original_filename;
  const extension = EXTENSION_BY_LANGUAGE[item.language ?? "plaintext"] ?? "txt";
  return sanitizeFilename(`${item.title}.${extension}`);
}

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/shares/[shareId]/items/[itemId]/content">,
) {
  return route(async () => {
    const { shareId, itemId } = await ctx.params;
    const context = await getAccessContext(request);
    const resolved = await requireReadableShare(shareId, context);
    const item = await getItemForShare(itemId, resolved.row.id);

    const url = new URL(request.url);
    const wantsAttachment =
      url.searchParams.get("download") === "1" ||
      url.searchParams.get("disposition") === "attachment";

    const baseHeaders: Record<string, string> = {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    };

    if (item.item_type !== "file") {
      if (wantsAttachment && !resolved.canDownload) {
        throw forbidden("Downloads are disabled for this share.");
      }
      const body = item.content ?? "";
      return new Response(body, {
        headers: {
          ...baseHeaders,
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": contentDisposition(
            wantsAttachment ? "attachment" : "inline",
            textFileName(item),
          ),
        },
      });
    }

    if (!resolved.canDownload) {
      throw forbidden("Downloads are disabled for this share.");
    }
    if (!item.storage_key) {
      throw forbidden("This item has no stored object.");
    }

    const filename = item.original_filename ?? "file";
    const size = Number(item.size_bytes ?? 0);
    const classification = classifyStoredFile(item.mime_type, filename, size);
    const inlineAllowed =
      !wantsAttachment &&
      (classification === "image" ||
        classification === "pdf" ||
        classification === "audio" ||
        classification === "video");
    const disposition = inlineAllowed ? "inline" : "attachment";

    // Active-content types are always served as opaque bytes.
    const contentType =
      inlineAllowed && item.mime_type ? item.mime_type : "application/octet-stream";

    const storage = getStorage();

    // Drivers that support signing answer with a short-lived URL. Attachments
    // may redirect to it (the browser downloads directly; CSP does not apply).
    // Inline previews must stay same-origin — the page CSP allows only 'self'
    // for frames, images and media — so those bytes are streamed back through
    // this handler and the signed URL never reaches the browser.
    const signed = await storage.createSignedDownload(
      item.storage_key,
      60,
      disposition === "attachment" ? filename : undefined,
    );
    if (signed && disposition === "attachment") {
      return new Response(null, {
        status: 302,
        headers: { ...baseHeaders, Location: signed },
      });
    }

    if (signed) {
      return await streamSignedObject({
        signedUrl: signed,
        rangeHeader: request.headers.get("range"),
        contentType,
        contentDisposition: contentDisposition(disposition, filename),
        baseHeaders,
      });
    }

    // Local driver: stream through this handler.
    if (storage.name === "local") {
      const local = storage as LocalStorageDriver;
      const info = await local.head(item.storage_key);
      if (!info) throw forbidden("Stored object not found.");
      const range = parseRange(request.headers.get("range"), info.size);

      const headers: Record<string, string> = {
        ...baseHeaders,
        "Content-Type": contentType,
        "Content-Disposition": contentDisposition(disposition, filename),
        "Accept-Ranges": "bytes",
      };

      const { Readable } = await import("node:stream");

      if (range === "invalid") {
        return new Response(null, {
          status: 416,
          headers: { ...headers, "Content-Range": `bytes */${info.size}` },
        });
      }
      if (range) {
        headers["Content-Range"] = `bytes ${range.start}-${range.end}/${info.size}`;
        headers["Content-Length"] = String(range.end - range.start + 1);
        const stream = Readable.toWeb(
          local.stream(item.storage_key, range),
        ) as ReadableStream<Uint8Array>;
        return new Response(stream, { status: 206, headers });
      }

      headers["Content-Length"] = String(info.size);
      const stream = Readable.toWeb(local.stream(item.storage_key)) as ReadableStream<Uint8Array>;
      return new Response(stream, { status: 200, headers });
    }

    throw forbidden("Storage driver does not support streaming downloads.");
  });
}
