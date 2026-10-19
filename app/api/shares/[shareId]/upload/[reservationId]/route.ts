import { rateLimitKeyFor } from "@/lib/http/request";
import { jsonOk, route } from "@/lib/http/responses";
import { getAccessContext } from "@/lib/services/context";
import { authorizeManageShare } from "@/lib/services/shares";
import { abortDirectUpload, completeDirectUpload } from "@/lib/services/uploads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/shares/[shareId]/upload/[reservationId]
 * Verify a direct-to-storage upload (real size + magic bytes) and publish the
 * file item. Rejected uploads are deleted from storage.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/shares/[shareId]/upload/[reservationId]">,
) {
  return route(async () => {
    const { shareId, reservationId } = await ctx.params;
    const context = await getAccessContext(request);
    const resolved = await authorizeManageShare(shareId, context);
    const item = await completeDirectUpload(
      resolved,
      context,
      rateLimitKeyFor(request, "upload"),
      reservationId,
    );
    return jsonOk({ item }, { status: 201 });
  });
}

/** DELETE /api/shares/[shareId]/upload/[reservationId] — abandon an upload. */
export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/shares/[shareId]/upload/[reservationId]">,
) {
  return route(async () => {
    const { shareId, reservationId } = await ctx.params;
    const context = await getAccessContext(request);
    const resolved = await authorizeManageShare(shareId, context);
    await abortDirectUpload(resolved, reservationId);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  });
}
