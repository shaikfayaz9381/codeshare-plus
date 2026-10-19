import { __setAuthResolverForTests } from "@/lib/auth/actor";

/** Request/response helpers for exercising real route handlers in tests. */

export interface RouteParams {
  [key: string]: string;
}

/** Route handlers receive `{ params: Promise<...> }` in Next.js 16. */
export function ctx<P extends RouteParams>(params: P): { params: Promise<P> } {
  return { params: Promise.resolve(params) };
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  cookie?: string;
  ip?: string;
  userAgent?: string;
  headers?: Record<string, string>;
}

export function jsonRequest(url: string, options: RequestOptions = {}): Request {
  return new Request(url, {
    method: options.method ?? "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": options.ip ?? "203.0.113.1",
      "user-agent": options.userAgent ?? "vitest",
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.headers ?? {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

export function getRequest(url: string, options: RequestOptions = {}): Request {
  return new Request(url, {
    method: "GET",
    headers: {
      "x-forwarded-for": options.ip ?? "203.0.113.1",
      "user-agent": options.userAgent ?? "vitest",
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.headers ?? {}),
    },
  });
}

export function multipartRequest(
  url: string,
  fields: { file: File },
  options: RequestOptions = {},
): Request {
  const form = new FormData();
  form.append("file", fields.file, fields.file.name);
  return new Request(url, {
    method: options.method ?? "POST",
    headers: {
      "x-forwarded-for": options.ip ?? "203.0.113.1",
      "user-agent": options.userAgent ?? "vitest",
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.headers ?? {}),
    },
    body: form,
  });
}

/** Parse Set-Cookie headers into a name -> value map (values are raw). */
export function readSetCookies(response: Response): Record<string, string> {
  const result: Record<string, string> = {};
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const raw: string[] = headers.getSetCookie
    ? headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  for (const header of raw) {
    if (!header) continue;
    const [pair] = header.split(";");
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    result[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return result;
}

/** Build a Cookie request header from pairs. */
export function cookieHeader(pairs: Record<string, string | undefined>): string {
  return Object.entries(pairs)
    .filter(([, value]) => Boolean(value))
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

/** Simulate an authenticated session (guarded test seam; production-safe). */
export function actAsUser(userId: string): void {
  __setAuthResolverForTests({ getUserId: async () => userId });
}

export function actAsAnonymous(): void {
  __setAuthResolverForTests(null);
}

export async function readJson<T = unknown>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export function zipFromBuffer(jszip: typeof import("jszip"), bytes: Uint8Array) {
  return jszip.loadAsync(bytes);
}
