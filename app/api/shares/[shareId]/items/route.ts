import { createItemSchema, reorderItemsSchema } from "@/lib/validation/schemas";
import { readJson } from "@/lib/http/request";
import { jsonOk, route } from "@/lib/http/responses";
import { getAccessContext } from "@/lib/services/context";
import { authorizeManageShare, requireReadableShare } from "@/lib/services/shares";
import { createContentItem, listItemSummaries, reorderShareItems } from "@/lib/services/items";

export const dynamic = "force-dynamic";

/** GET /api/shares/[shareId]/items — item summaries (no content). */
export async function GET(request: Request, ctx: RouteContext<"/api/shares/[shareId]/items">) {
  return route(async () => {
    const { shareId } = await ctx.params;
    const context = await getAccessContext(request);
    const resolved = await requireReadableShare(shareId, context);
    const items = await listItemSummaries(resolved.row.id);
    return jsonOk({ items, canEdit: resolved.canEdit });
  });
}

/** POST /api/shares/[shareId]/items — add a code snippet or text note. */
export async function POST(request: Request, ctx: RouteContext<"/api/shares/[shareId]/items">) {
  return route(async () => {
    const { shareId } = await ctx.params;
    const context = await getAccessContext(request);
    const resolved = await authorizeManageShare(shareId, context);
    const input = await readJson(request, createItemSchema);
    const item = await createContentItem(resolved, input);
    return jsonOk({ item }, { status: 201 });
  });
}

/** PUT /api/shares/[shareId]/items — persist a new ordering (all item ids). */
export async function PUT(request: Request, ctx: RouteContext<"/api/shares/[shareId]/items">) {
  return route(async () => {
    const { shareId } = await ctx.params;
    const context = await getAccessContext(request);
    const resolved = await authorizeManageShare(shareId, context);
    const input = await readJson(request, reorderItemsSchema);
    await reorderShareItems(resolved, input.itemIds);
    const items = await listItemSummaries(resolved.row.id);
    return jsonOk({ items });
  });
}
