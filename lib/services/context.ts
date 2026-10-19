import "server-only";
import {
  GRANT_COOKIE_MAX_AGE,
  GRANTS_COOKIE_NAME,
  GUEST_COOKIE_MAX_AGE,
  type GrantCookieEntry,
  parseGrantsCookie,
} from "@/lib/security/cookies";
import { getActor as resolveActorFromRequest } from "@/lib/auth/actor";
import { sha256Hex } from "@/lib/security/digest";
import { newToken, newShareId } from "@/lib/security/ids";
import { randomUUID } from "node:crypto";
import type { Actor } from "@/types";

/** Per-request security context for route handlers. */

export interface AccessContext {
  actor: Actor;
  grants: Map<string, GrantCookieEntry>;
  /** Guest token hash when the caller presented a guest capability. */
  guestTokenHash: string | null;
}

export async function getAccessContext(request: Request): Promise<AccessContext> {
  const actor = await resolveActorFromRequest(request);
  const grants = parseGrantsCookie(readCookie(request, GRANTS_COOKIE_NAME));
  return {
    actor,
    grants,
    guestTokenHash: actor.kind === "guest" ? actor.tokenHash : null,
  };
}

/**
 * Access context for React Server Components.
 *
 * Pages receive no `Request`; `next/headers` supplies the same cookies the
 * route handlers read. A synthetic request keeps a single actor/cookie parsing
 * path for pages and APIs. Imported lazily because `next/headers` only exists
 * inside a Next.js request context (unit tests import this module too).
 */
export async function getPageAccessContext(): Promise<AccessContext> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((cookie) => `${cookie.name}=${encodeURIComponent(cookie.value)}`)
    .join("; ");
  const request = new Request("http://internal.local/", {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  });
  return getAccessContext(request);
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return null;
}

/** New guest capability token (returned once, stored by the client in a cookie). */
export function createGuestToken(): { token: string; hash: string } {
  const token = newToken();
  return { token, hash: sha256Hex(token) };
}

export function createGrantSecrets(): {
  grantId: string;
  secret: string;
  hash: string;
  maxAgeSeconds: number;
} {
  const secret = newToken();
  return {
    grantId: randomUUID(),
    secret,
    hash: sha256Hex(secret),
    maxAgeSeconds: GRANT_COOKIE_MAX_AGE,
  };
}

export { GUEST_COOKIE_MAX_AGE, GRANT_COOKIE_MAX_AGE, GRANTS_COOKIE_NAME, newShareId, newToken };
