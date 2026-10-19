#!/usr/bin/env node
/**
 * Local development database.
 *
 * Boots a real PostgreSQL instance (via embedded-postgres, no Docker or root
 * required), applies the Supabase-like bootstrap and all migrations, then keeps
 * running until Ctrl+C. Prints a ready-to-paste DATABASE_URL.
 *
 *   npm run dev:db            # start (reuses .data/pg when present)
 *   npm run dev:db -- --reset # wipe and re-create
 *
 * This is a development convenience only. Production uses Supabase Postgres.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import net from "node:net";
import EmbeddedPostgres from "embedded-postgres";

const args = process.argv.slice(2);
const reset = args.includes("--reset");
const port = Number(process.env.LOCAL_PG_PORT ?? 54329);
const dataDir = path.join(process.cwd(), ".data", "pg");

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${port} is already in use. Another local database is probably running. ` +
              `Stop it or set LOCAL_PG_PORT to a free port.`,
          ),
        );
      } else reject(err);
    });
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

async function main() {
  if (reset && existsSync(dataDir)) {
    rmSync(dataDir, { recursive: true, force: true });
  }
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  await assertPortFree(port);

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "codeshare",
    password: "codeshare",
    port,
    persistent: true,
  });

  if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
    console.log("Initialising PostgreSQL cluster ...");
    await pg.initialise();
  }
  await pg.start();

  const client = pg.getPgClient("postgres");
  await client.connect();
  const { rows } = await client.query(`select 1 from pg_database where datname = 'codeshare_plus'`);
  if (rows.length === 0) {
    await client.query(`create database codeshare_plus`);
  }
  await client.end();

  // Apply bootstrap + migrations with the shared runner.
  const url = `postgres://codeshare:codeshare@127.0.0.1:${port}/codeshare_plus`;
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), "scripts", "db-migrate.mjs"), "--url", url, "--bootstrap"],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    await pg.stop();
    process.exit(result.status ?? 1);
  }

  console.log("\nLocal PostgreSQL ready.");
  console.log(`DATABASE_URL=${url}`);
  console.log("Press Ctrl+C to stop.\n");

  const shutdown = async () => {
    console.log("\nStopping local PostgreSQL ...");
    try {
      await pg.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
