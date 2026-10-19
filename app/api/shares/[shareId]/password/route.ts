import { verifyPasswordSchema } from "@/lib/validation/schemas";
import { rateLimitKeyFor, readJson } from "@/lib/http/request";
import { jsonOk, route } from "@/lib/http/responses";
import { getAccessContext, readCookie } from "@/lib/services/context";
import {
  requireShare,
  verifySharePasswordAndIssueGrant,
  accessStateError,
} from "@/lib/services/shares";
import {
  GRANTS_COOKIE_NAME,
  cookieOptions,
  parseGrantsCookie,
  serializeCookie,
  upsertGrantCookie,
} from "@/lib/security/cookies";
import { enforceLimit, limitSpecs } from "@/lib/rate-limit";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/shares/[shareId]/password
 *
 * Verifies a share password and issues a short-lived, share-bound access grant
 * (revocable server-side). Attempts are rate limited per IP + share. Passwords
 * and grant secrets are never logged.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/shares/[shareId]/password">) {
  return route(async () => {
    const { shareId } = await ctx.params;
    const context = await getAccessContext(request);
    const resolved = await requireShare(shareId, context);

    if (resolved.access === "expired") throw accessStateError("expired");
    if (resolved.access === "revoked") throw accessStateError("revoked");
    if (resolved.access === "ok") {
      // Already authorized (unprotected share or a valid grant cookie).
      return jsonOk({ state: "ok", alreadyAuthorized: true });
    }
    if (!resolved.row.password_hash) {
      throw new AppError("validation_error", "This share is not password protected.", {
        status: 400,
      });
    }

    const specs = limitSpecs();
    await enforceLimit(
      `password:${shareId}:${rateLimitKeyFor(request, "pw")}`,
      specs.passwordAttempt,
    );

    const input = await readJson(request, verifyPasswordSchema);
    const grant = await verifySharePasswordAndIssueGrant(resolved, input.password);

    const existing = parseGrantsCookie(readCookie(request, GRANTS_COOKIE_NAME));
    const cookieValue = upsertGrantCookie(existing, shareId, {
      grantId: grant.grantId,
      secret: grant.secret,
    });

    return jsonOk(
      { state: "ok", expiresInSeconds: grant.maxAgeSeconds },
      {
        cookies: [
          serializeCookie(GRANTS_COOKIE_NAME, cookieValue, cookieOptions(grant.maxAgeSeconds)),
        ],
      },
    );
  });
}
