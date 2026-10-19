import "server-only";
import type { z } from "zod";
import { badRequest, payloadTooLarge } from "@/lib/errors";
import { zodIssues } from "@/lib/validation/schemas";
import { privacyHash } from "@/lib/security/digest";

/** Request parsing helpers used by route handlers. */

export function parseWith<T>(schema: z.ZodType<T>, input: unknown, what = "request"): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw badRequest(`Invalid ${what}.`, zodIssues(result.error));
  }
  return result.data;
}

export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes = 2 * 1024 * 1024,
): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw badRequest("Expected a JSON request body.");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > maxBytes) {
    throw payloadTooLarge("Request body is too large.");
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw badRequest("Request body is not valid JSON.");
  }
  return parseWith(schema, body, "request body");
}

export function readQuery<T>(request: Request, schema: z.ZodType<T>): T {
  const url = new URL(request.url);
  const raw: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (!(key in raw)) raw[key] = value;
  }
  return parseWith(schema, raw, "query parameters");
}

/**
 * Best-effort client identity for rate limiting.
 * On Vercel/most proxies `x-forwarded-for` is set by the platform (first entry
 * is the client). We only ever persist a salted hash of this value.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  return "unknown";
}

/** Stable, salted, non-reversible rate-limit key for a request. */
export function rateLimitKeyFor(request: Request, scope: string): string {
  const ip = clientIp(request);
  const ua = request.headers.get("user-agent") ?? "";
  return `${scope}:${privacyHash(`${ip}|${ua.slice(0, 120)}`)}`;
}

/** Guard for bodies read via arrayBuffer (uploads) before buffering. */
export function assertContentLength(request: Request, maxBytes: number): void {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw payloadTooLarge(
      `This file is larger than the ${Math.floor(maxBytes / (1024 * 1024))} MB proxy limit.`,
    );
  }
}
