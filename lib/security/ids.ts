import "server-only";
import { randomBytes } from "node:crypto";

/**
 * Identifier and token generation.
 *
 * - Share IDs: 128 bits of entropy, base64url encoded (22 chars, URL-safe).
 *   A share ID is an unguessable *locator*, not an authorization mechanism.
 * - Capability tokens (guest management, access grants): 256 bits.
 * - Only hashes of capability tokens are persisted (see lib/security/digest.ts).
 */

export const SHARE_ID_BYTES = 16;
export const TOKEN_BYTES = 32;

export function newShareId(): string {
  return randomBytes(SHARE_ID_BYTES).toString("base64url");
}

export function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function newUuid(): string {
  return crypto.randomUUID();
}

export { sha256Hex, safeEqualHex, safeEqualString, privacyHash } from "@/lib/security/digest";
