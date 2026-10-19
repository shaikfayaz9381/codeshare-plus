import { reserveUploadSchema } from "@/lib/validation/schemas";
import { rateLimitKeyFor, readJson } from "@/lib/http/request";
import { assertContentLength } from "@/lib/http/request";
import { jsonOk, route } from "@/lib/http/responses";
import { getAccessContext } from "@/lib/services/context";
import { authorizeManageShare } from "@/lib/services/shares";
import { reserveDirectUpload, storeProxiedUpload } from "@/lib/services/uploads";
import { enforceLimit, limitSpecs } from "@/lib/rate-limit";
import { limits } from "@/lib/config/env";
import { badRequest, payloadTooLarge } from "@/lib/errors";

export const dynamic = "force-dynamic";
/** Node runtime: byte sniffing and multipart parsing are Node APIs. */
export const runtime = "nodejs";

/**
 * POST /api/shares/[shareId]/upload
 *
 * Two transports on one endpoint (driven by Content-Type):
 *  - multipart/form-data  -> proxied upload (browser XHR tracks progress),
 *                            bounded by MAX_PROXIED_UPLOAD_MB
 *  - application/json     -> reserve a direct-to-storage upload for larger
 *                            files; returns a short-lived signed upload URL
 *                            (falls back to `mode: "proxy"` when the storage
 *                            driver does not support direct uploads)
 */
export async function POST(request: Request, ctx: RouteContext<"/api/shares/[shareId]/upload">) {
  return route(async () => {
    const { shareId } = await ctx.params;
    const context = await getAccessContext(request);
    const resolved = await authorizeManageShare(shareId, context);

    const specs = limitSpecs();
    await enforceLimit(`upload:${rateLimitKeyFor(request, "upload")}`, specs.upload);

    const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
    const l = limits();

    if (contentType.includes("application/json")) {
      const input = await readJson(request, reserveUploadSchema);
      const result = await reserveDirectUpload(
        resolved,
        context,
        rateLimitKeyFor(request, "upload"),
        input,
      );
      return jsonOk(result, { status: result.mode === "direct" ? 201 : 200 });
    }

    if (contentType.includes("multipart/form-data")) {
      assertContentLength(request, l.maxProxiedUploadBytes + 512 * 1024);
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        throw badRequest("Could not read the multipart upload body.");
      }
      const file = form.get("file");
      if (!(file instanceof File)) {
        throw badRequest('Multipart uploads must include a "file" field.');
      }
      if (file.size > l.maxProxiedUploadBytes) {
        throw payloadTooLarge(
          `Files above ${Math.floor(l.maxProxiedUploadBytes / (1024 * 1024))} MB must use a direct-to-storage upload.`,
        );
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const item = await storeProxiedUpload(resolved, context, rateLimitKeyFor(request, "upload"), {
        bytes,
        filename: file.name || "file",
        declaredMime: file.type || null,
      });
      return jsonOk({ item }, { status: 201 });
    }

    throw badRequest("Unsupported Content-Type. Use multipart/form-data or application/json.");
  });
}
