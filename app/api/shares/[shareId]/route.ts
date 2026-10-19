import { updateShareSchema } from "@/lib/validation/schemas";
import { readJson } from "@/lib/http/request";
import { jsonOk, route } from "@/lib/http/responses";
import { getAccessContext } from "@/lib/services/context";
import {
  authorizeManageShare,
  deleteShareForManager,
  updateShareForManager,
} from "@/lib/services/shares";
import { buildViewerPayload } from "@/lib/services/viewer";
import { appUrl } from "@/lib/config/env";

export const dynamic = "force-dynamic";

/**
 * GET /api/shares/[shareId]
 * Access state + share metadata (+ item summaries when readable).
 * Passwords are verified separately via POST .../password.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/shares/[shareId]">) {
  return route(async () => {
    const { shareId } = await ctx.params;
    const context = await getAccessContext(request);
    const { payload, status } = await buildViewerPayload(shareId, context, {
      includeItems: true,
      recordView: true,
    });
    return jsonOk(payload, { status });
  });
}

/** PATCH /api/shares/[shareId] — update metadata (managers only). */
export async function PATCH(request: Request, ctx: RouteContext<"/api/shares/[shareId]">) {
  return route(async () => {
    const { shareId } = await ctx.params;
    const context = await getAccessContext(request);
    const resolved = await authorizeManageShare(shareId, context);
    const input = await readJson(request, updateShareSchema);
    const { publicShare, passwordChanged } = await updateShareForManager(resolved, input);
    return jsonOk({
      share: publicShare,
      passwordChanged,
      url: `${appUrl()}/s/${publicShare.shareId}`,
    });
  });
}

/** DELETE /api/shares/[shareId] — delete the share and its stored objects. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/shares/[shareId]">) {
  return route(async () => {
    const { shareId } = await ctx.params;
    const context = await getAccessContext(request);
    const resolved = await authorizeManageShare(shareId, context);
    await deleteShareForManager(resolved);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  });
}
