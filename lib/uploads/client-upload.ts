import { api } from "@/lib/api/client";
import type { ShareItemDetail } from "@/types";

/**
 * Browser upload pipeline.
 *
 * The server decides the transport (`POST .../upload` with a JSON body reserves
 * an upload and answers either `mode: "proxy"` or `mode: "direct"`), so the
 * client never guesses and quotas are checked before any bytes move:
 *
 * 1. `reserve`   — server validates size/count/quotas and picks a transport
 * 2. `transport` — multipart to our API (small files, local driver) or
 *                  signed PUT to private storage (large files)
 * 3. `complete`  — server re-reads the object, sniffs magic bytes, publishes
 *                  the item; failures abort the reservation
 *
 * Progress is reported through XMLHttpRequest for the proxy path and the
 * Supabase client for the direct path.
 */

export interface UploadProgress {
  loaded: number;
  total: number;
}

export interface UploadOptions {
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

function proxyUpload(
  shareId: string,
  file: File,
  options: UploadOptions,
): Promise<ShareItemDetail> {
  return new Promise<ShareItemDetail>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/shares/${encodeURIComponent(shareId)}/upload`);
    request.responseType = "text";

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        options.onProgress?.({ loaded: event.loaded, total: event.total });
      }
    });

    const abort = () => request.abort();
    options.signal?.addEventListener("abort", abort, { once: true });

    request.addEventListener("load", () => {
      options.signal?.removeEventListener("abort", abort);
      let payload: unknown = null;
      try {
        payload = request.responseText ? JSON.parse(request.responseText) : null;
      } catch {
        payload = null;
      }
      if (request.status >= 200 && request.status < 300) {
        const item = (payload as { item?: ShareItemDetail } | null)?.item;
        if (!item) {
          reject(new UploadError("The upload finished but no item was returned."));
          return;
        }
        resolve(item);
        return;
      }
      const message =
        (payload as { error?: { message?: string } } | null)?.error?.message ??
        `Upload failed with status ${request.status}.`;
      reject(new UploadError(message));
    });

    request.addEventListener("error", () => {
      options.signal?.removeEventListener("abort", abort);
      reject(new UploadError("The upload could not be completed. Check your connection."));
    });

    request.addEventListener("abort", () => {
      options.signal?.removeEventListener("abort", abort);
      reject(new UploadError("Upload cancelled."));
    });

    const form = new FormData();
    form.append("file", file, file.name);
    request.send(form);
  });
}

async function directUpload(
  shareId: string,
  file: File,
  reservation: Extract<Awaited<ReturnType<typeof api.upload.reserve>>, { mode: "direct" }>,
  options: UploadOptions,
): Promise<ShareItemDetail> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    // Storage is configured server-side only (service role), so the browser
    // cannot use the signed URL. Say so precisely instead of failing vaguely.
    throw new UploadError(
      "Large uploads need NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to be configured. " +
        "Files up to the proxy limit still upload normally.",
    );
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  options.onProgress?.({ loaded: 0, total: file.size });
  const { error } = await supabase.storage
    .from(reservation.bucket)
    .uploadToSignedUrl(reservation.path, reservation.token, file, {
      contentType: file.type || undefined,
    });

  if (error) {
    await api.upload.abort(shareId, reservation.reservationId).catch(() => {});
    throw new UploadError(error.message || "The storage upload failed.");
  }

  options.onProgress?.({ loaded: file.size, total: file.size });
  const { item } = await api.upload.complete(shareId, reservation.reservationId);
  return item;
}

/**
 * Upload one file into a share and return the created item.
 * Throws `UploadError` (or `ApiError` from the API layer) with a user-safe message.
 */
export async function uploadShareFile(
  shareId: string,
  file: File,
  options: UploadOptions = {},
): Promise<ShareItemDetail> {
  if (file.size === 0) {
    throw new UploadError(`"${file.name}" is empty. Empty files cannot be shared.`);
  }

  const reservation = await api.upload.reserve(shareId, {
    filename: file.name || "file",
    size: file.size,
    ...(file.type ? { mimeType: file.type } : {}),
  });

  if (reservation.mode === "proxy") {
    return proxyUpload(shareId, file, options);
  }

  return directUpload(shareId, file, reservation, options);
}
