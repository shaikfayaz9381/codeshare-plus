import "server-only";
import bcrypt from "bcryptjs";
import { bcryptCost } from "@/lib/config/env";

/**
 * Share password hashing (bcrypt).
 *
 * - Cost factor is configurable (BCRYPT_COST, default 12) to keep verification
 *   latency acceptable on serverless platforms.
 * - bcrypt's `compare` performs a constant-time comparison internally.
 * - Hashes never leave the server: the data-access layer exposes only
 *   `hasPassword: boolean` to the rest of the application.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, bcryptCost());
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    // Malformed hash: fail closed, never throw details to callers.
    return false;
  }
}

export interface PasswordValidationResult {
  ok: boolean;
  message?: string;
}

export function validatePasswordStrength(password: string): PasswordValidationResult {
  if (typeof password !== "string") return { ok: false, message: "Password must be a string." };
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (length > PASSWORD_MAX_LENGTH) {
    return { ok: false, message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.` };
  }
  return { ok: true };
}

/**
 * Dummy hash used to keep verification timing consistent when a share has no
 * password (prevents timing-based detection of password protection).
 */
export const DUMMY_BCRYPT_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEeO7ZBm2qZbLq2hwl.rPnRKcV4VQ8K7VZi";
