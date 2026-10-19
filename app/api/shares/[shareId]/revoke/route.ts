import { jsonOk, route } from "@/lib/http/responses";
import { getAccessContext } from "@/lib/services/context";
import { revokeShareForManager } from "@/lib/services/shares";
import { authorizeManageShare } from "@/lib/services/shares";

export const dynamic = "force-dynamic";

/**
 * POST /api/shares/[shareId]/revoke
 * Immediately invalidates the share: subsequent reads, previews and downloads
 * fail with a 403 revoked state, and every outstanding access grant is revoked.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/shares/[shareId]/revoke">) {
  return route(async () => {
    const { shareId } = await ctx.params;
    const context = await getAccessContext(request);
    const resolved = await authorizeManageShare(shareId, context);
    await revokeShareForManager(resolved);
    return jsonOk({ revoked: true, shareId });
  });
}
