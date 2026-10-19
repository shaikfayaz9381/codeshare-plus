import "server-only";
import { limits } from "@/lib/config/env";
import { AppError } from "@/lib/errors";
import { consumeUsage, usageAvailable } from "@/lib/db/repositories/counters";

/**
 * Rate limiting and quota enforcement.
 *
 * All counters live in PostgreSQL (`usage_counters` + the atomic
 * `consume_usage` function), so limits hold across serverless instances.
 * Keys must be salted hashes (see lib/http/request.ts:rateLimitKeyFor).
 *
 * When a counter backend error occurs the request is allowed (fail-open for
 * availability) but the error is logged — except for password attempts, which
 * fail closed.
 */

export interface LimitSpec {
  limit: number;
  windowSeconds: number;
  failClosed?: boolean;
}

export function limitSpecs(): Record<string, LimitSpec> {
  const l = limits();
  return {
    createShareGuest: { limit: l.rateLimitCreatePerHour, windowSeconds: 3600 },
    createShareUser: { limit: l.rateLimitCreatePerHour * 6, windowSeconds: 3600 },
    passwordAttempt: {
      limit: l.rateLimitPasswordPer15Min,
      windowSeconds: l.rateLimitPasswordWindowSeconds,
      failClosed: true,
    },
    upload: { limit: l.rateLimitUploadPerHour, windowSeconds: 3600 },
    read: { limit: l.rateLimitReadPerMinute, windowSeconds: 60 },
    downloadAll: { limit: 10, windowSeconds: 3600 },
  };
}

export interface LimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

export async function checkLimit(key: string, spec: LimitSpec, amount = 1): Promise<LimitResult> {
  try {
    return await consumeUsage(key, amount, spec.limit, spec.windowSeconds);
  } catch (error) {
    if (spec.failClosed) {
      throw new AppError("rate_limited", "Too many attempts. Please try again later.", {
        retryAfterSeconds: 60,
        cause: error,
      });
    }
    console.error(
      "[codeshare] rate-limit backend error (failing open):",
      error instanceof Error ? error.message : error,
    );
    return {
      allowed: true,
      remaining: spec.limit,
      resetAt: new Date(Date.now() + spec.windowSeconds * 1000),
    };
  }
}

/** Throwing variant for route handlers. */
export async function enforceLimit(key: string, spec: LimitSpec, amount = 1): Promise<void> {
  const result = await checkLimit(key, spec, amount);
  if (!result.allowed) {
    const retryAfter = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
    throw new AppError("rate_limited", "Too many requests. Please try again later.", {
      retryAfterSeconds: retryAfter,
    });
  }
}

/** Non-consuming quota check (used before creating upload reservations). */
export async function hasQuota(key: string, amount: number, limit: number): Promise<boolean> {
  try {
    return await usageAvailable(key, amount, limit);
  } catch {
    return true;
  }
}

export interface QuotaExceededFn {
  (message: string): never;
}

/** Consume a byte/count quota, throwing `quotaExceeded` when the limit is hit. */
export async function consumeQuota(
  key: string,
  amount: number,
  limit: number,
  windowSeconds: number,
  message: string,
): Promise<void> {
  const result = await checkLimit(key, { limit, windowSeconds }, amount);
  if (!result.allowed) {
    throw new AppError("quota_exceeded", message, { status: 429 });
  }
}
