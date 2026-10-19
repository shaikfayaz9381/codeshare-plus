import { updateItemSchema } from "@/lib/validation/schemas";
import { readJson } from "@/lib/http/request";
import { jsonOk, route } from "@/lib/http/responses";
import { getAccessContext } from "@/lib/services/context";
import { authorizeManageShare, requireReadableShare } from "@/lib/services/shares";
import { deleteItemForShare, getItemForShare, updateContentItem } from "@/lib/services/items";
import { toItemDetail } from "@/lib/db/rows";

export const dynamic = "force-dynamic";

/** GET /api/shares/[shareId]/items/[itemId] — item detail (content for code/text). */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/shares/[shareId]/items/[itemId]">,
) {
  return route(async () => {
    const { shareId, itemId } = await ctx.params;
    const context = await getAccessContext(request);
    const resolved = await requireReadableShare(shareId, context, { recordView: true });
    const item = await getItemForShare(itemId, resolved.row.id);
    return jsonOk({ item: toItemDetail(item) });
  });
}

/** PATCH /api/shares/[shareId]/items/[itemId] — rename/edit (managers only). */
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/shares/[shareId]/items/[itemId]">,
) {
  return route(async () => {
    const { shareId, itemId } = await ctx.params;
    const context = await getAccessContext(request);
    const resolved = await authorizeManageShare(shareId, context);
    const input = await readJson(request, updateItemSchema);
    const item = await updateContentItem(resolved, itemId, input);
    return jsonOk({ item });
  });
}

/** DELETE /api/shares/[shareId]/items/[itemId] — remove item (and object). */
export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/shares/[shareId]/items/[itemId]">,
) {
  return route(async () => {
    const { shareId, itemId } = await ctx.params;
    const context = await getAccessContext(request);
    const resolved = await authorizeManageShare(shareId, context);
    await deleteItemForShare(resolved, itemId);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  });
}
