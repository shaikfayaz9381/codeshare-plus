import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

/**
 * Vitest global setup for integration tests.
 *
 * Boots a real, disposable PostgreSQL instance (no Docker/root required),
 * applies supabase/local/bootstrap_local.sql (Supabase-like auth/storage stubs
 * and roles) followed by every migration in supabase/migrations — the exact
 * same runner used for development and CI. Exposes DATABASE_URL and a local
 * storage directory to the test workers.
 */

const projectRoot = path.resolve(__dirname, "..", "..");
const dataRoot = path.join(projectRoot, ".data", "test");

let postgres: EmbeddedPostgres | null = null;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address) {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Could not determine a free port")));
      }
    });
  });
}

export async function setup(): Promise<void> {
  const pgDir = path.join(dataRoot, "pg");
  const storageDir = path.join(dataRoot, "storage");
  rmSync(pgDir, { recursive: true, force: true });
  rmSync(storageDir, { recursive: true, force: true });
  mkdirSync(pgDir, { recursive: true });
  mkdirSync(storageDir, { recursive: true });

  const port = await freePort();
  postgres = new EmbeddedPostgres({
    databaseDir: pgDir,
    user: "codeshare_test",
    password: "codeshare_test",
    port,
    persistent: false,
  });

  await postgres.initialise();
  await postgres.start();

  const admin = postgres.getPgClient("postgres");
  await admin.connect();
  await admin.query("create database codeshare_plus_test");
  await admin.end();

  const databaseUrl = `postgres://codeshare_test:codeshare_test@127.0.0.1:${port}/codeshare_plus_test`;

  execFileSync(
    process.execPath,
    [path.join(projectRoot, "scripts", "db-migrate.mjs"), "--url", databaseUrl, "--bootstrap"],
    { cwd: projectRoot, stdio: "pipe" },
  );

  process.env.DATABASE_URL = databaseUrl;
  process.env.STORAGE_DRIVER = "local";
  process.env.LOCAL_STORAGE_DIR = storageDir;
  process.env.HASH_SALT = "integration-test-salt";
  process.env.BCRYPT_COST = "10";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  // Auth is not configured for integration tests; authenticated paths are
  // exercised through the guarded test seam (lib/auth/actor.ts).
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Sanity check: the harness must fail loudly rather than silently passing.
  const { default: postgresClient } = await import("postgres");
  const sql = postgresClient(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
  const rows = await sql<{ n: number }[]>`select count(*)::int as n from public.applied_migrations`;
  if ((rows[0]?.n ?? 0) < 4) {
    throw new Error(`Migration harness failed: only ${rows[0]?.n ?? 0} migrations recorded.`);
  }
  await sql.end();
}

export async function teardown(): Promise<void> {
  if (postgres) {
    await postgres.stop().catch(() => {});
    postgres = null;
  }
  if (existsSync(path.join(dataRoot, "pg"))) {
    rmSync(path.join(dataRoot, "pg"), { recursive: true, force: true });
  }
}
