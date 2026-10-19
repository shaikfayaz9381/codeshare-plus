import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  assertContentLength,
  clientIp,
  parseWith,
  rateLimitKeyFor,
  readJson,
  readQuery,
} from "@/lib/http/request";
import { AppError } from "@/lib/errors";

function jsonPost(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/test", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

describe("clientIp", () => {
  it("uses the first forwarded address, then fallbacks", () => {
    expect(
      clientIp(
        new Request("http://x/", { headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" } }),
      ),
    ).toBe("203.0.113.5");
    expect(clientIp(new Request("http://x/", { headers: { "x-real-ip": "198.51.100.7" } }))).toBe(
      "198.51.100.7",
    );
    expect(
      clientIp(new Request("http://x/", { headers: { "cf-connecting-ip": "192.0.2.9" } })),
    ).toBe("192.0.2.9");
    expect(clientIp(new Request("http://x/"))).toBe("unknown");
  });
});

describe("rateLimitKeyFor", () => {
  it("is stable per client and never contains the raw address", () => {
    const request = new Request("http://x/", {
      headers: { "x-forwarded-for": "203.0.113.5", "user-agent": "vitest-agent" },
    });
    const key = rateLimitKeyFor(request, "create");
    expect(key).toBe(rateLimitKeyFor(request, "create"));
    expect(key).toMatch(/^create:[0-9a-f]{64}$/);
    expect(key).not.toContain("203.0.113.5");
    expect(key).not.toContain("vitest-agent");
  });

  it("separates scopes, addresses and user agents", () => {
    const a = new Request("http://x/", {
      headers: { "x-forwarded-for": "203.0.113.5", "user-agent": "a" },
    });
    const b = new Request("http://x/", {
      headers: { "x-forwarded-for": "203.0.113.6", "user-agent": "a" },
    });
    const c = new Request("http://x/", {
      headers: { "x-forwarded-for": "203.0.113.5", "user-agent": "b" },
    });
    expect(rateLimitKeyFor(a, "upload")).not.toBe(rateLimitKeyFor(b, "upload"));
    expect(rateLimitKeyFor(a, "upload")).not.toBe(rateLimitKeyFor(c, "upload"));
    expect(rateLimitKeyFor(a, "upload")).not.toBe(rateLimitKeyFor(a, "create"));
  });
});

describe("readJson", () => {
  const schema = z.object({ name: z.string().min(1) });

  it("parses valid JSON bodies", async () => {
    await expect(readJson(jsonPost('{"name":"ok"}'), schema)).resolves.toEqual({ name: "ok" });
  });

  it("rejects wrong content types, oversized bodies and malformed JSON", async () => {
    await expect(
      readJson(
        new Request("http://localhost:3000/api/test", {
          method: "POST",
          body: "{}",
          headers: { "content-type": "text/plain" },
        }),
        schema,
      ),
    ).rejects.toMatchObject({ code: "validation_error" });

    await expect(
      readJson(jsonPost("{}", { "content-length": String(5 * 1024 * 1024) }), schema),
    ).rejects.toMatchObject({
      code: "payload_too_large",
    });

    await expect(readJson(jsonPost("{not json"), schema)).rejects.toMatchObject({
      code: "validation_error",
    });

    await expect(readJson(jsonPost('{"name":""}'), schema)).rejects.toMatchObject({
      code: "validation_error",
    });
  });
});

describe("readQuery and parseWith", () => {
  const schema = z.object({
    q: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
  });

  it("parses query strings and reports issues with paths", () => {
    const parsed = readQuery(new Request("http://localhost:3000/api/test?q=hello&page=3"), schema);
    expect(parsed).toEqual({ q: "hello", page: 3 });

    try {
      readQuery(new Request("http://localhost:3000/api/test?page=0"), schema);
      throw new Error("expected a validation error");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe("validation_error");
      expect(JSON.stringify(appError.details)).toContain("page");
    }
  });

  it("parses plain objects", () => {
    expect(parseWith(schema, { page: "2" })).toEqual({ page: 2 });
    expect(() => parseWith(schema, { page: "-1" })).toThrow(AppError);
  });
});

describe("assertContentLength", () => {
  it("allows unset or small lengths and rejects declared oversize", () => {
    expect(() => assertContentLength(new Request("http://x/"), 1024)).not.toThrow();
    expect(() =>
      assertContentLength(new Request("http://x/", { headers: { "content-length": "500" } }), 1024),
    ).not.toThrow();
    expect(() =>
      assertContentLength(
        new Request("http://x/", { headers: { "content-length": "2048" } }),
        1024,
      ),
    ).toThrow(AppError);
  });
});
