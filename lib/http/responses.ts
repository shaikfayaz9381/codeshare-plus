import "server-only";
import { errorResponse } from "@/lib/errors";

/** Small helpers shared by all route handlers. */

export function jsonOk<T>(
  data: T,
  init: { status?: number; cookies?: string[]; headers?: Record<string, string> } = {},
): Response {
  const response = Response.json(data, {
    status: init.status ?? 200,
    headers: { "Cache-Control": "no-store", ...(init.headers ?? {}) },
  });
  for (const cookie of init.cookies ?? []) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}

/** Wrap a handler so unexpected errors become safe JSON responses. */
export async function route(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    return errorResponse(error);
  }
}

/** Method not allowed with an explicit Allow header (never 500 for methods). */
export function methodNotAllowed(allowed: string[]): Response {
  return Response.json(
    {
      error: {
        code: "validation_error",
        message: `Method not allowed. Allowed: ${allowed.join(", ")}`,
      },
    },
    { status: 405, headers: { Allow: allowed.join(", "), "Cache-Control": "no-store" } },
  );
}
