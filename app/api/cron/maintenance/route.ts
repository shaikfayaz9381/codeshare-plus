import { jsonOk, methodNotAllowed, route } from "@/lib/http/responses";
import { runMaintenance } from "@/lib/services/cleanup";
import { unauthorized } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * GET|POST /api/cron/maintenance
 *
 * Cleans up abandoned uploads, expired grants, usage counters and long-expired
 * shares. Protected by CRON_SECRET (Authorization: Bearer <secret> or
 * ?secret=). When CRON_SECRET is not configured the endpoint is only reachable
 * outside production, so a misconfigured deployment never exposes a
 * destructive job.
 */
async function handle(request: Request): Promise<Response> {
  return route(async () => {
    const secret = process.env.CRON_SECRET;

    if (!secret) {
      if (process.env.NODE_ENV === "production") {
        throw unauthorized("Maintenance endpoint is disabled: CRON_SECRET is not configured.");
      }
    } else {
      const header = request.headers.get("authorization");
      const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
      const querySecret = new URL(request.url).searchParams.get("secret");
      if (bearer !== secret && querySecret !== secret) {
        throw unauthorized("Invalid maintenance credentials.");
      }
    }

    const report = await runMaintenance();
    return jsonOk({ ok: true, report, ranAt: new Date().toISOString() });
  });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

export async function PUT() {
  return methodNotAllowed(["GET", "POST"]);
}
