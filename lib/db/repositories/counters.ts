import "server-only";
import { db } from "@/lib/db/client";

/**
 * Persistent, shared rate-limit and quota counters.
 *
 * Uses the atomic `consume_usage` SQL function so concurrent serverless
 * instances cannot exceed limits (no in-memory state). Keys are salted hashes
 * (see lib/security/digest.ts) — raw IP addresses are never stored.
 */

export interface UsageResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

export async function consumeUsage(
  key: string,
  amount: number,
  limit: number,
  windowSeconds: number,
): Promise<UsageResult> {
  const rows = await db()<{ allowed: boolean; remaining: number; reset_at: Date }[]>`
    select * from public.consume_usage(${key}, ${amount}, ${limit}, ${windowSeconds})
  `;
  const row = rows[0];
  if (!row) return { allowed: true, remaining: limit, resetAt: new Date() };
  return { allowed: row.allowed, remaining: row.remaining, resetAt: row.reset_at };
}

/** Non-consuming availability check (used before upload reservations). */
export async function usageAvailable(key: string, amount: number, limit: number): Promise<boolean> {
  const rows = await db()<{ usage_available: boolean }[]>`
    select public.usage_available(${key}, ${amount}, ${limit}) as usage_available
  `;
  return rows[0]?.usage_available ?? true;
}

/** Read a counter without consuming (tests/diagnostics). */
export async function peekUsage(
  key: string,
): Promise<{ counter: number; windowStartedAt: Date; windowSeconds: number } | null> {
  const rows = await db()<{ counter: number; window_started_at: Date; window_seconds: number }[]>`
    select * from public.peek_usage(${key})
  `;
  const row = rows[0];
  return row
    ? {
        counter: row.counter,
        windowStartedAt: row.window_started_at,
        windowSeconds: row.window_seconds,
      }
    : null;
}

/** Reset a counter (tests only; revoked from client roles in SQL). */
export async function resetUsage(key: string): Promise<void> {
  await db()`delete from public.usage_counters where bucket_key = ${key}`;
}

export async function pruneUsageCounters(olderThan: string = "2 days"): Promise<number> {
  const rows = await db()<{ prune_usage_counters: number }[]>`
    select public.prune_usage_counters(${olderThan}::interval) as prune_usage_counters
  `;
  return rows[0]?.prune_usage_counters ?? 0;
}
