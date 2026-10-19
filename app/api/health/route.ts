import { envStatus, publicLimits } from "@/lib/config/env";
import { pingDb } from "@/lib/db/client";
import { pingStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Reports safe dependency status (configuration presence, database
 * connectivity, storage reachability). Never includes secret values.
 * Returns 503 when a required dependency for persistence is unavailable so
 * uptime monitors and deployment checks can act on it.
 */
export async function GET() {
  const status = envStatus();

  const database = status.database.configured
    ? await pingDb()
    : { ok: false, detail: "DATABASE_URL is not configured." };

  const storage = status.storage.configured
    ? await pingStorage()
    : { ok: false, detail: status.storage.detail || "Storage is not configured.", driver: "none" };

  const auth = {
    ok: status.auth.configured,
    detail: status.auth.configured
      ? "Supabase Auth configured (accounts enabled)."
      : "Supabase Auth not configured. Guest sharing works; accounts are disabled.",
  };

  const ok = database.ok && storage.ok;

  return Response.json(
    {
      ok,
      state: ok ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      environment: status.nodeEnv,
      appUrl: status.appUrl,
      checks: { database, storage, auth },
      limits: publicLimits(),
      ...(status.configError ? { configError: status.configError } : {}),
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
