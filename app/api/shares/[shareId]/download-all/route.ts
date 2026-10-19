import { route } from "@/lib/http/responses";
import { getAccessContext } from "@/lib/services/context";
import { requireReadableShare } from "@/lib/services/shares";
import { listItemRows } from "@/lib/services/items";
import {
  buildArchiveStream,
  planArchiveEntries,
  validateArchivePlan,
} from "@/lib/downloads/archive";
import { getStorage } from "@/lib/storage";
import { sanitizeFilename } from "@/lib/security/filenames";
import { enforceLimit, limitSpecs } from "@/lib/rate-limit";
import { rateLimitKeyFor } from "@/lib/http/request";
import { limits } from "@/lib/config/env";
import { AppError, forbidden } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/shares/[shareId]/download-all
 *
 * Streams a ZIP of the collection: file items as binary entries, code/text
 * items as text entries. Only items of the requested share are included; the
 * archive respects expiry, revocation, password grants and the download policy.
 * Entry names are sanitized and de-duplicated; a byte budget bounds memory.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/shares/[shareId]/download-all">,
) {
  return route(async () => {
    const { shareId } = await ctx.params;
    const context = await getAccessContext(request);
    const resolved = await requireReadableShare(shareId, context);

    if (!resolved.canDownload) {
      throw forbidden("Downloads are disabled for this share.");
    }

    const specs = limitSpecs();
    await enforceLimit(
      `download-all:${shareId}:${rateLimitKeyFor(request, "zip")}`,
      specs.downloadAll,
    );

    const rows = await listItemRows(resolved.row.id);
    const l = limits();

    const entries = planArchiveEntries(
      rows.map((row) => ({
        id: row.id,
        type: row.item_type,
        title: row.title,
        language: row.language,
        content: row.content,
        storageKey: row.storage_key,
        originalFilename: row.original_filename,
        sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
      })),
    );

    if (entries.length === 0) {
      throw new AppError("validation_error", "This share has no items to include in an archive.", {
        status: 400,
      });
    }

    const problem = validateArchivePlan(entries, {
      maxEntries: 200,
      maxTotalBytes: l.maxZipTotalBytes,
    });
    if (problem) {
      throw new AppError(
        "payload_too_large",
        problem.reason === "entries"
          ? `This collection has too many items for a single archive (${problem.actual}). Download items individually.`
          : `This collection is larger than the ${Math.floor(l.maxZipTotalBytes / (1024 * 1024))} MB archive limit. Download items individually.`,
        { status: 413 },
      );
    }

    const storage = getStorage();
    const { stream } = await buildArchiveStream(entries, async (storageKey) => {
      const info = await storage.head(storageKey);
      if (!info || info.size > l.maxUploadBytes) return null;
      return storage.get(storageKey);
    });

    const archiveName = `${sanitizeFilename(resolved.publicShare.title, "share").replace(/\.[a-z0-9]+$/i, "")}-${resolved.publicShare.shareId.slice(0, 8)}.zip`;

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${archiveName.replace(/["\\]/g, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
