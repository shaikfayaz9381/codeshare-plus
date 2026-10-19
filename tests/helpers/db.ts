import { randomUUID } from "node:crypto";
import { rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db/client";

/**
 * Integration test database helpers. These run against the disposable
 * PostgreSQL instance booted by tests/setup/global-setup.ts.
 */

export function testDb() {
  return db();
}

export async function resetDatabase(): Promise<void> {
  const sql = db();
  await sql.unsafe(`
    truncate table public.shares cascade;
    truncate table public.usage_counters;
    delete from public.profiles;
    delete from auth.users;
  `);
  resetStorageDir();
}

export function storageDir(): string {
  return process.env.LOCAL_STORAGE_DIR ?? path.join(process.cwd(), ".data", "test", "storage");
}

export function resetStorageDir(): void {
  const dir = storageDir();
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

/** Create an authenticated user row (auth.users stub in local/test). */
export async function createTestUser(email?: string): Promise<string> {
  const id = randomUUID();
  await db()`
    insert into auth.users (id, email, raw_user_meta_data)
    values (${id}, ${email ?? `user-${id.slice(0, 8)}@example.test`}, '{}'::jsonb)
  `;
  return id;
}

export async function countRows(
  table: "shares" | "share_items" | "share_access_grants" | "upload_reservations",
): Promise<number> {
  const rows = await db()<{ n: number }[]>`select count(*)::int as n from public.${db()(table)}`;
  return rows[0]?.n ?? 0;
}

/** Unique client IP per test so rate-limit buckets stay isolated. */
let ipCounter = 10;
export function uniqueIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter % 250}:${ipCounter}`;
}
