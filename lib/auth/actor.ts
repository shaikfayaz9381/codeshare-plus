import "server-only";
import { sha256Hex } from "@/lib/security/digest";
import { GUEST_COOKIE_NAME } from "@/lib/security/cookies";
import { supabaseConfigured, getSupabaseUser } from "@/lib/supabase/server";
import type { Actor } from "@/types";

/**
 * Request actor resolution.
 *
 * Order of precedence:
 *   1. verified Supabase session (server-validated; never client-supplied)
 *   2. guest management capability cookie (hashed for comparison)
 *   3. anonymous
 *
 * The test seam below is hard-guarded against production and is only used by
 * the automated integration test suite to exercise authenticated paths without
 * a network dependency on Supabase Auth.
 */

export interface AuthResolver {
  getUserId(): Promise<string | null>;
}

let testResolver: AuthResolver | null = null;

export function __setAuthResolverForTests(resolver: AuthResolver | null): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("__setAuthResolverForTests is not available in production builds");
  }
  testResolver = resolver;
}

export async function resolveUserId(): Promise<string | null> {
  if (testResolver) return testResolver.getUserId();
  if (!supabaseConfigured()) return null;
  const user = await getSupabaseUser();
  return user?.id ?? null;
}

const GUEST_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;

/** Parse a raw Cookie header without a framework dependency (unit-testable). */
export function readGuestTokenFromCookieHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (name !== GUEST_COOKIE_NAME) continue;
    const raw = part.slice(eq + 1).trim();
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      return null;
    }
    return GUEST_TOKEN_PATTERN.test(value) ? value : null;
  }
  return null;
}

export function readGuestTokenFromRequest(request: Request): string | null {
  return readGuestTokenFromCookieHeader(request.headers.get("cookie"));
}

export function actorFromUserId(userId: string | null, guestToken: string | null): Actor {
  if (userId) return { kind: "user", userId };
  if (guestToken) return { kind: "guest", tokenHash: sha256Hex(guestToken) };
  return { kind: "anonymous" };
}

/** Resolve the actor for a route handler request. */
export async function getActor(request: Request): Promise<Actor> {
  const userId = await resolveUserId();
  const guestToken = readGuestTokenFromRequest(request);
  return actorFromUserId(userId, guestToken);
}
