#!/usr/bin/env node
/**
 * Apply CodeShare Plus SQL migrations to a PostgreSQL database.
 *
 * Usage:
 *   node scripts/db-migrate.mjs [--reset] [--bootstrap] [--url <connection>]
 *
 *   --reset       drop the public/auth/storage schemas first (local only; refuses
 *                 when NODE_ENV=production unless CONFIRM_RESET=yes)
 *   --bootstrap   create Supabase-like stubs (auth/storage schemas, roles) before
 *                 applying migrations. Local development and tests ONLY.
 *   --url         override DATABASE_URL
 *
 * Migrations live in supabase/migrations and are applied in filename order.
 * Every migration is written to be idempotent, and applied versions are also
 * recorded in public.applied_migrations (creating it when missing).
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";

/**
 * Load `.env` then `.env.local` exactly like `next dev` does (later file wins,
 * real environment variables always win) so `npm run db:migrate` works without
 * exporting DATABASE_URL in the shell.
 */
async function loadDotEnv() {
  const preset = new Set(Object.keys(process.env));
  for (const file of [".env", ".env.local"]) {
    let text;
    try {
      text = await readFile(path.join(process.cwd(), file), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match) continue;
      const [, key, raw] = match;
      if (preset.has(key)) continue;
      let value = raw;
      if (
        (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
        (value.startsWith("'") && value.endsWith("'") && value.length > 1)
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

await loadDotEnv();

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

function resolveUrl() {
  const url = valueOf("--url") ?? process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "No database URL. Set DATABASE_URL in .env.local or pass --url postgres://user:pass@host:5432/db",
    );
    process.exit(1);
  }
  return url;
}

async function main() {
  const url = resolveUrl();
  const reset = has("--reset");
  const bootstrap = has("--bootstrap");

  if (reset && process.env.NODE_ENV === "production" && process.env.CONFIRM_RESET !== "yes") {
    console.error(
      "Refusing to --reset with NODE_ENV=production. Set CONFIRM_RESET=yes to override.",
    );
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
  const bootstrapFile = path.join(process.cwd(), "supabase", "local", "bootstrap_local.sql");

  try {
    if (reset) {
      console.log("Resetting schemas public, auth, storage ...");
      await sql.unsafe(`
        drop schema if exists public cascade;
        drop schema if exists auth cascade;
        drop schema if exists storage cascade;
        create schema public;
      `);
    }

    if (bootstrap) {
      console.log("Applying local bootstrap (auth/storage stubs, roles) ...");
      await sql.unsafe(await readFile(bootstrapFile, "utf8"));
    }

    await sql.unsafe(`
      create table if not exists public.applied_migrations (
        version text primary key,
        applied_at timestamptz not null default now()
      );
    `);

    const applied = new Set(
      (await sql`select version from public.applied_migrations`).map((r) => r.version),
    );

    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    if (files.length === 0) {
      console.error("No migrations found in supabase/migrations.");
      process.exit(1);
    }

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`= ${file} (already applied)`);
        continue;
      }
      const source = await readFile(path.join(migrationsDir, file), "utf8");
      process.stdout.write(`> ${file} ... `);
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(source);
          await tx`insert into public.applied_migrations (version) values (${file})`;
        });
        console.log("ok");
      } catch (error) {
        console.log("FAILED");
        throw error;
      }
    }

    const [{ count }] = await sql`select count(*)::int as count from public.applied_migrations`;
    console.log(`\nMigrations applied: ${count}/${files.length}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("\nMigration failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
