import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Hashing helpers shared by server code and pure permission logic.
 * No secrets live here; cryptographic comparison utilities only.
 */

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Constant-time comparison of two digests.
 * Returns false for length mismatches before comparing.
 */
export function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

export function safeEqualString(a: string, b: string): boolean {
  return safeEqualHex(sha256Hex(a), sha256Hex(b));
}

/**
 * Pseudonymous key for rate limiting and analytics. IP addresses and user
 * agents are never stored raw; only salted hashes enter the database.
 * Configure HASH_SALT in production; the fallback keeps development usable.
 */
export function privacyHash(value: string): string {
  const salt = process.env.HASH_SALT ?? "codeshare-plus-default-hash-salt";
  return sha256Hex(`${salt}:${value}`);
}
