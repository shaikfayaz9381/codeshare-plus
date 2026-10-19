import { dashboardQuerySchema } from "@/lib/validation/schemas";
import { readQuery } from "@/lib/http/request";
import { jsonOk, route } from "@/lib/http/responses";
import { getAccessContext } from "@/lib/services/context";
import { listSharesForActor } from "@/lib/services/shares";
import { appUrl } from "@/lib/config/env";
import { unauthorized } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard
 * Overview for the authenticated user or guest session: aggregate stats plus
 * the most recent collections (persisted data only).
 */
export async function GET(request: Request) {
  return route(async () => {
    const context = await getAccessContext(request);
    if (context.actor.kind === "anonymous") {
      throw unauthorized("Sign in or restore your guest session to view your collections.");
    }

    const query = readQuery(request, dashboardQuerySchema);

    const all = await listSharesForActor(context, { page: 1, perPage: 1, status: "all" });
    const active = await listSharesForActor(context, { page: 1, perPage: 1, status: "active" });
    const expired = await listSharesForActor(context, { page: 1, perPage: 1, status: "expired" });
    const revokedCount = await listSharesForActor(context, {
      page: 1,
      perPage: 1,
      status: "revoked",
    });

    const recent = await listSharesForActor(context, {
      search: query.q,
      visibility: query.visibility,
      status: query.status,
      sort: query.sort,
      page: query.page,
      perPage: query.perPage,
    });

    return jsonOk({
      stats: {
        total: all.total,
        active: active.total,
        expired: expired.total,
        revoked: revokedCount.total,
      },
      recent: recent.shares.map((row) => ({
        shareId: row.share_id,
        title: row.title,
        description: row.description,
        visibility: row.visibility,
        hasPassword: Boolean(row.password_hash),
        expiresAt: row.expires_at?.toISOString() ?? null,
        revokedAt: row.revoked_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        itemCount: Number(row.item_count ?? 0),
        totalBytes: Number(row.total_bytes ?? 0),
        url: `${appUrl()}/s/${row.share_id}`,
      })),
      page: recent.page,
      perPage: recent.perPage,
      total: recent.total,
      totalPages: Math.max(1, Math.ceil(recent.total / recent.perPage)),
    });
  });
}
