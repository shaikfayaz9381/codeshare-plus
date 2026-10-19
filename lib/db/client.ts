import "server-only";
import postgres from "postgres";
import { databaseUrl, nodeEnv } from "@/lib/config/env";

/**
 * Server-only PostgreSQL access (Supabase Postgres).
 *
 * - The connection string is a privileged server credential and never reaches
 *   the browser. All data access in this application goes through this module.
 * - `prepare: false` keeps the client compatible with Supavisor/pgbouncer
 *   transaction pooling (Supabase pooler on port 6543).
 * - The pool is cached on globalThis so Next.js dev-mode HMR does not leak
 *   connections.
 */

export type Sql = postgres.Sql;

const globalForDb = globalThis as unknown as { __codeshareSql?: Sql };

function createClient(): Sql {
  return postgres(databaseUrl(), {
    max: nodeEnv() === "production" ? 5 : 3,
    idle_timeout: 20,
    connect_timeout: 15,
    max_lifetime: 60 * 20,
    prepare: false,
    onnotice: () => {},
    transform: { undefined: null },
    types: {
      // int8 is returned as a string by default. Every int8 column in this
      // schema is quota-bounded (file sizes <= MAX_UPLOAD_MB, counters bounded
      // by configured limits), so Number is exact here and much easier to work
      // with than BigInt. Values above 2^53 are not produced by this schema.
      bigint: {
        to: 20,
        from: [20],
        serialize: (value: number) => String(value),
        parse: (value: string) => Number(value),
      },
    },
  }) as unknown as Sql;
}

export function db(): Sql {
  if (!globalForDb.__codeshareSql) {
    globalForDb.__codeshareSql = createClient();
  }
  return globalForDb.__codeshareSql;
}

/** Close the pool (used by scripts and graceful shutdown; tests). */
export async function closeDb(): Promise<void> {
  if (globalForDb.__codeshareSql) {
    await globalForDb.__codeshareSql.end({ timeout: 5 });
    globalForDb.__codeshareSql = undefined;
  }
}

export async function pingDb(): Promise<{ ok: boolean; detail: string }> {
  try {
    const rows = await db()`select 1 as ok`;
    return rows[0]?.ok === 1
      ? { ok: true, detail: "connected" }
      : { ok: false, detail: "unexpected response" };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "connection failed" };
  }
}
