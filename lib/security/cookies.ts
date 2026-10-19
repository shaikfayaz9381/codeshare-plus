import "server-only";
import { nodeEnv } from "@/lib/config/env";

/**
 * Cookie plumbing.
 *
 * - `cs_guest`: guest management capability (raw 256-bit token, HttpOnly).
 *   The server stores only its SHA-256 hash. It is never shown in a share URL.
 * - `cs_grants`: password access grants, one per share:
 *      `<shareId>:<grantId>.<secret>` entries joined by `|`.
 *   The server stores only the hash of `<secret>` and binds each grant to a
 *   single share in the database.
 */

export const GUEST_COOKIE_NAME = "cs_guest";
export const GRANTS_COOKIE_NAME = "cs_grants";

export const GUEST_COOKIE_MAX_AGE = 180 * 24 * 60 * 60; // 180 days
export const GRANT_COOKIE_MAX_AGE = 12 * 60 * 60; // 12 hours

const MAX_GRANT_ENTRIES = 20;

export interface GrantCookieEntry {
  grantId: string;
  secret: string;
}

export function parseGrantsCookie(value: string | undefined | null): Map<string, GrantCookieEntry> {
  const map = new Map<string, GrantCookieEntry>();
  if (!value) return map;
  for (const part of value.split("|")) {
    const sep = part.indexOf(":");
    if (sep <= 0) continue;
    const shareId = part.slice(0, sep);
    const rest = part.slice(sep + 1);
    const dot = rest.indexOf(".");
    if (dot <= 0) continue;
    const grantId = rest.slice(0, dot);
    const secret = rest.slice(dot + 1);
    if (!shareId || !grantId || !secret) continue;
    if (!/^[A-Za-z0-9_-]{10,64}$/.test(shareId)) continue;
    if (!/^[0-9a-f-]{36}$/.test(grantId)) continue;
    if (!/^[A-Za-z0-9_-]{20,128}$/.test(secret)) continue;
    map.set(shareId, { grantId, secret });
    if (map.size >= MAX_GRANT_ENTRIES) break;
  }
  return map;
}

export function serializeGrantsCookie(map: Map<string, GrantCookieEntry>): string {
  const entries: string[] = [];
  for (const [shareId, entry] of map) {
    entries.push(`${shareId}:${entry.grantId}.${entry.secret}`);
    if (entries.length >= MAX_GRANT_ENTRIES) break;
  }
  return entries.join("|");
}

export function upsertGrantCookie(
  map: Map<string, GrantCookieEntry>,
  shareId: string,
  entry: GrantCookieEntry,
): string {
  const next = new Map(map);
  next.delete(shareId);
  next.set(shareId, entry);
  return serializeGrantsCookie(next);
}

export interface CookieOptions {
  httpOnly: boolean;
  sameSite: "lax" | "strict" | "none";
  secure: boolean;
  path: string;
  maxAge: number;
}

export function cookieOptions(maxAge: number, opts: Partial<CookieOptions> = {}): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: nodeEnv() === "production",
    path: "/",
    maxAge,
    ...opts,
  };
}

/** Build a `Set-Cookie` header value. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path}`);
  parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  parts.push(
    `SameSite=${options.sameSite === "lax" ? "Lax" : options.sameSite === "strict" ? "Strict" : "None"}`,
  );
  return parts.join("; ");
}

export function clearCookie(name: string): string {
  return serializeCookie(name, "", cookieOptions(0));
}
