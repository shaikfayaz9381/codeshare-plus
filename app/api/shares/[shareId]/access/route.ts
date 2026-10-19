import { jsonOk, route } from "@/lib/http/responses";
import { getAccessContext } from "@/lib/services/context";
import { buildViewerPayload } from "@/lib/services/viewer";

export const dynamic = "force-dynamic";

/**
 * GET /api/shares/[shareId]/access
 * Lightweight access state for the viewer (no item list). Used after password
 * verification, after edits, and by clients that poll for revocation/expiry.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/shares/[shareId]/access">) {
  return route(async () => {
    const { shareId } = await ctx.params;
    const context = await getAccessContext(request);
    const { payload, status } = await buildViewerPayload(shareId, context, { includeItems: false });
    return jsonOk(payload, { status });
  });
}
