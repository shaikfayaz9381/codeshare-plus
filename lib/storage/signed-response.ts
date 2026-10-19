import "server-only";
import { AppError } from "@/lib/errors";

/**
 * Relay a short-lived signed storage URL through the server.
 *
 * Previews must stay same-origin: the page CSP only allows `'self'` for
 * frames, images and media (and the signed URL itself is a bearer capability
 * that should never be handed to the browser). The upstream `Range` header is
 * forwarded so PDF viewers and media players can seek, and range responses
 * keep their exact `Content-Range`/`Content-Length` metadata.
 */
export interface StreamSignedObjectOptions {
  signedUrl: string;
  rangeHeader: string | null;
  contentType: string;
  contentDisposition: string;
  baseHeaders: Record<string, string>;
}

export async function streamSignedObject(options: StreamSignedObjectOptions): Promise<Response> {
  const upstream = await fetch(options.signedUrl, {
    cache: "no-store",
    headers: options.rangeHeader ? { Range: options.rangeHeader } : undefined,
  }).catch(() => null);

  if (!upstream || (upstream.status !== 200 && upstream.status !== 206)) {
    // Release the error body so the socket can be reused.
    await upstream?.body?.cancel().catch(() => {});
    throw new AppError("storage_unavailable", "The stored file could not be read.", {
      status: 502,
    });
  }

  const headers: Record<string, string> = {
    ...options.baseHeaders,
    "Content-Type": options.contentType,
    "Content-Disposition": options.contentDisposition,
    "Accept-Ranges": "bytes",
  };
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) headers["Content-Range"] = contentRange;
  // Range responses are never content-encoded, so their length is exact.
  const contentLength = upstream.headers.get("content-length");
  if (upstream.status === 206 && contentLength) {
    headers["Content-Length"] = contentLength;
  }

  return new Response(upstream.body, {
    status: upstream.status === 206 ? 206 : 200,
    headers,
  });
}
