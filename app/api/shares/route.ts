import { createShareSchema, dashboardQuerySchema } from "@/lib/validation/schemas";
import { readJson, readQuery, rateLimitKeyFor } from "@/lib/http/request";
import { jsonOk, route } from "@/lib/http/responses";
import { getAccessContext } from "@/lib/services/context";
import { createShare, listSharesForActor } from "@/lib/services/shares";
import {
  GUEST_COOKIE_MAX_AGE,
  GUEST_COOKIE_NAME,
  cookieOptions,
  serializeCookie,
} from "@/lib/security/cookies";
import { appUrl } from "@/lib/config/env";

export const dynamic = "force-dynamic";

/**
 * GET /api/shares — collections owned by the current actor (account or guest
 * capability). Supports search, filtering, sorting and pagination.
 */
export async function GET(request: Request) {
  return route(async () => {
    const context = await getAccessContext(request);
    const query = readQuery(request, dashboardQuerySchema);
    const result = await listSharesForActor(context, {
      search: query.q,
      visibility: query.visibility,
      status: query.status,
      sort: query.sort,
      page: query.page,
      perPage: query.perPage,
    });
    return jsonOk({
      shares: result.shares.map((row) => ({
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
      total: result.total,
      page: result.page,
      perPage: result.perPage,
      totalPages: Math.max(1, Math.ceil(result.total / result.perPage)),
    });
  });
}

/**
 * POST /api/shares — create a collection.
 * Guests receive a management capability cookie exactly once; only its hash is
 * stored server-side.
 */
export async function POST(request: Request) {
  return route(async () => {
    const context = await getAccessContext(request);
    const input = await readJson(request, createShareSchema);
    const created = await createShare(input, context, rateLimitKeyFor(request, "create"));

    const cookies: string[] = [];
    if (created.guestToken) {
      cookies.push(
        serializeCookie(GUEST_COOKIE_NAME, created.guestToken, cookieOptions(GUEST_COOKIE_MAX_AGE)),
      );
    }

    return jsonOk(
      {
        share: created.resolved.publicShare,
        url: `${appUrl()}/s/${created.resolved.publicShare.shareId}`,
        /** True when this browser holds the management capability for the share. */
        canManage: true,
      },
      { status: 201, cookies },
    );
  });
}
