/**
 * Application error model.
 *
 * Route handlers translate `AppError` into safe JSON responses. Anything that is
 * not an `AppError` becomes a generic 500 without leaking internals.
 */

export type ErrorCode =
  | "validation_error"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "expired"
  | "revoked"
  | "password_required"
  | "rate_limited"
  | "payload_too_large"
  | "unsupported_type"
  | "quota_exceeded"
  | "config_missing"
  | "storage_unavailable"
  | "internal_error";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly expose: boolean;
  readonly details?: unknown;
  readonly retryAfterSeconds?: number;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      status?: number;
      expose?: boolean;
      details?: unknown;
      retryAfterSeconds?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = options.status ?? defaultStatus(code);
    this.expose = options.expose ?? true;
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

function defaultStatus(code: ErrorCode): number {
  switch (code) {
    case "validation_error":
      return 400;
    case "unauthorized":
      return 401;
    case "forbidden":
    case "password_required":
    case "revoked":
      return 403;
    case "not_found":
      return 404;
    case "expired":
      return 410;
    case "conflict":
      return 409;
    case "rate_limited":
      return 429;
    case "payload_too_large":
      return 413;
    case "unsupported_type":
      return 415;
    case "quota_exceeded":
      return 429;
    case "config_missing":
    case "storage_unavailable":
    case "internal_error":
      return 500;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError("validation_error", message, { details });
export const unauthorized = (message = "Authentication required.") =>
  new AppError("unauthorized", message);
export const forbidden = (message = "You do not have permission to perform this action.") =>
  new AppError("forbidden", message);
export const notFound = (message = "The requested resource was not found.") =>
  new AppError("not_found", message);
export const conflict = (message: string) => new AppError("conflict", message);
export const expired = (message = "This share has expired.") => new AppError("expired", message);
export const revoked = (message = "This share has been revoked.") =>
  new AppError("revoked", message);
export const passwordRequired = (message = "This share is password protected.") =>
  new AppError("password_required", message);
export const rateLimited = (
  message = "Too many requests. Please try again later.",
  retryAfterSeconds = 60,
) => new AppError("rate_limited", message, { retryAfterSeconds });
export const payloadTooLarge = (message: string) => new AppError("payload_too_large", message);
export const unsupportedType = (message: string) => new AppError("unsupported_type", message);
export const quotaExceeded = (message: string) => new AppError("quota_exceeded", message);

/** Turn unknown errors into safe JSON. Used by every route handler. */
export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (error.retryAfterSeconds) headers["Retry-After"] = String(error.retryAfterSeconds);
    const errorBody: Record<string, unknown> = { code: error.code, message: error.message };
    if (error.details !== undefined && error.expose) errorBody.details = error.details;
    return Response.json({ error: errorBody }, { status: error.status, headers });
  }

  // Configuration errors are actionable, expose them without secrets.
  if (error instanceof Error && error.name === "ConfigurationError") {
    return Response.json(
      { error: { code: "config_missing", message: error.message } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Unexpected: log server-side (redacted by the logger) and return a generic message.
  console.error("[codeshare] unhandled error:", error instanceof Error ? error.message : error);
  return Response.json(
    { error: { code: "internal_error", message: "An unexpected error occurred." } },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}
