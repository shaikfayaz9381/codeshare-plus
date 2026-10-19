import type {
  PublicShare,
  ShareItemDetail,
  ShareItemSummary,
  ShareViewerPayload,
  UploadReservation,
} from "@/types";
import type {
  CreateItemInput,
  CreateShareInput,
  UpdateItemInput,
  UpdateShareInput,
} from "@/lib/validation/schemas";

/**
 * Browser-side API client.
 *
 * Every call goes through `apiFetch`, which:
 * - sends same-origin credentials (the guest capability cookie must travel),
 * - never caches (the API is per-request data),
 * - turns the server's `{ error: { code, message, details } }` shape into an
 *   `ApiError` the UI can render without parsing strings.
 *
 * This module is deliberately free of `server-only` imports: client components
 * import it directly.
 */

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(payload: ApiErrorPayload, status: number) {
    super(payload.message);
    this.name = "ApiError";
    this.code = payload.code;
    this.status = status;
    this.details = payload.details;
  }

  /** Field-level messages from a Zod-backed `validation_error`, if any. */
  fieldErrors(): Record<string, string> {
    const details = this.details;
    if (!Array.isArray(details)) return {};
    const result: Record<string, string> = {};
    for (const entry of details) {
      if (typeof entry !== "object" || entry === null) continue;
      const { path, message } = entry as { path?: unknown; message?: unknown };
      if (typeof path === "string" && typeof message === "string" && !(path in result)) {
        result[path] = message;
      }
    }
    return result;
  }
}

interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  /** JSON request body (sets content-type and serializes). */
  json?: unknown;
  body?: BodyInit;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { json, headers, ...rest } = options;
  const requestHeaders = new Headers(headers);
  let body = options.body;

  if (json !== undefined) {
    requestHeaders.set("content-type", "application/json");
    body = JSON.stringify(json);
  }
  requestHeaders.set("accept", "application/json");

  const response = await fetch(path, {
    ...rest,
    headers: requestHeaders,
    body,
    credentials: "same-origin",
    cache: "no-store",
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const errorBody =
      typeof payload === "object" && payload !== null && "error" in payload
        ? ((payload as { error: ApiErrorPayload }).error ?? null)
        : null;
    throw new ApiError(
      errorBody ?? { code: "internal_error", message: "The request failed. Please try again." },
      response.status,
    );
  }

  return payload as T;
}

export interface CreateShareResponse {
  share: PublicShare;
  url: string;
  canManage: boolean;
}

export interface UpdateShareResponse {
  share: PublicShare;
  passwordChanged: boolean;
  url: string;
}

/** Typed endpoint wrappers used by the builder (and later the dashboard). */
export const api = {
  shares: {
    create: (input: CreateShareInput) =>
      apiFetch<CreateShareResponse>("/api/shares", { method: "POST", json: input }),

    get: (shareId: string) =>
      apiFetch<ShareViewerPayload>(`/api/shares/${encodeURIComponent(shareId)}`),

    update: (shareId: string, input: UpdateShareInput) =>
      apiFetch<UpdateShareResponse>(`/api/shares/${encodeURIComponent(shareId)}`, {
        method: "PATCH",
        json: input,
      }),

    remove: (shareId: string) =>
      apiFetch<void>(`/api/shares/${encodeURIComponent(shareId)}`, { method: "DELETE" }),

    /** Revocation is permanent: the API never clears `revokedAt`. */
    revoke: (shareId: string) =>
      apiFetch<{ revoked: true; shareId: string }>(
        `/api/shares/${encodeURIComponent(shareId)}/revoke`,
        { method: "POST" },
      ),
  },

  items: {
    list: (shareId: string) =>
      apiFetch<{ items: ShareItemSummary[]; canEdit: boolean }>(
        `/api/shares/${encodeURIComponent(shareId)}/items`,
      ),

    create: (shareId: string, input: CreateItemInput) =>
      apiFetch<{ item: ShareItemDetail }>(`/api/shares/${encodeURIComponent(shareId)}/items`, {
        method: "POST",
        json: input,
      }),

    get: (shareId: string, itemId: string) =>
      apiFetch<{ item: ShareItemDetail }>(
        `/api/shares/${encodeURIComponent(shareId)}/items/${encodeURIComponent(itemId)}`,
      ),

    update: (shareId: string, itemId: string, input: UpdateItemInput) =>
      apiFetch<{ item: ShareItemDetail }>(
        `/api/shares/${encodeURIComponent(shareId)}/items/${encodeURIComponent(itemId)}`,
        { method: "PATCH", json: input },
      ),

    remove: (shareId: string, itemId: string) =>
      apiFetch<void>(
        `/api/shares/${encodeURIComponent(shareId)}/items/${encodeURIComponent(itemId)}`,
        { method: "DELETE" },
      ),

    reorder: (shareId: string, itemIds: string[]) =>
      apiFetch<{ items: ShareItemSummary[] }>(`/api/shares/${encodeURIComponent(shareId)}/items`, {
        method: "PUT",
        json: { itemIds },
      }),
  },

  upload: {
    reserve: (shareId: string, input: { filename: string; size: number; mimeType?: string }) =>
      apiFetch<UploadReservation>(`/api/shares/${encodeURIComponent(shareId)}/upload`, {
        method: "POST",
        json: input,
      }),

    complete: (shareId: string, reservationId: string) =>
      apiFetch<{ item: ShareItemDetail }>(
        `/api/shares/${encodeURIComponent(shareId)}/upload/${encodeURIComponent(reservationId)}`,
        { method: "POST" },
      ),

    abort: (shareId: string, reservationId: string) =>
      apiFetch<void>(
        `/api/shares/${encodeURIComponent(shareId)}/upload/${encodeURIComponent(reservationId)}`,
        { method: "DELETE" },
      ),
  },
};

export type Api = typeof api;
