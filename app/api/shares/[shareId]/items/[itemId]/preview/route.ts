import { jsonOk, route } from "@/lib/http/responses";
import { getAccessContext } from "@/lib/services/context";
import { requireReadableShare } from "@/lib/services/shares";
import { getItemForShare } from "@/lib/services/items";
import { previewFileItem } from "@/lib/services/previews";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/shares/[shareId]/items/[itemId]/preview
 *
 * Server-prepared preview for file items: sanitized markdown HTML, parsed CSV
 * tables, bounded text reads, or media metadata. File bytes are only ever
 * served inline through the authorized content endpoint.
 *
 * Reading a file's content counts as file access, so `allow_download` gates
 * previews as well (disable downloads to share files as opaque metadata only).
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/shares/[shareId]/items/[itemId]/preview">,
) {
  return route(async () => {
    const { shareId, itemId } = await ctx.params;
    const context = await getAccessContext(request);
    const resolved = await requireReadableShare(shareId, context);
    const item = await getItemForShare(itemId, resolved.row.id);

    if (item.item_type !== "file") {
      throw new AppError("validation_error", "Preview is only available for file items.", {
        status: 400,
      });
    }
    if (!resolved.canDownload) {
      throw new AppError(
        "forbidden",
        "Downloads are disabled for this share, so file previews are unavailable.",
        {
          status: 403,
        },
      );
    }

    const preview = await previewFileItem(item);
    return jsonOk({ preview });
  });
}
