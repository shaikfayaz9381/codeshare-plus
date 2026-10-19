import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";
import { streamSignedObject } from "@/lib/storage/signed-response";

/**
 * The content route relays signed storage URLs through the server so previews
 * stay same-origin (and the signed URL never reaches the browser). These tests
 * exercise that relay against a real local HTTP server, including Range
 * forwarding for PDF viewers and media players.
 */

const BODY = Buffer.from(`%PDF-1.4\n${"x".repeat(1024)}\n%%EOF\n`, "utf8");

let server: Server;
let signedUrl: string;
let seenRange: string | null = null;
let denyNext = false;

beforeAll(async () => {
  server = createServer((request, response) => {
    if (denyNext) {
      response.statusCode = 403;
      response.end("denied");
      return;
    }
    seenRange = request.headers.range ?? null;
    const match = seenRange ? /^bytes=(\d+)-(\d*)$/.exec(seenRange) : null;
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), BODY.length - 1) : BODY.length - 1;
      const slice = BODY.subarray(start, end + 1);
      response.statusCode = 206;
      response.setHeader("content-type", "application/pdf");
      response.setHeader("content-range", `bytes ${start}-${end}/${BODY.length}`);
      response.setHeader("content-length", String(slice.length));
      response.end(slice);
      return;
    }
    response.statusCode = 200;
    response.setHeader("content-type", "application/pdf");
    response.end(BODY);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server has no port");
  signedUrl = `http://127.0.0.1:${address.port}/object/sign/sample.pdf?token=test`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function call(options: Partial<Parameters<typeof streamSignedObject>[0]> = {}) {
  return streamSignedObject({
    signedUrl,
    rangeHeader: null,
    contentType: "application/pdf",
    contentDisposition: 'inline; filename="sample.pdf"',
    baseHeaders: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    ...options,
  });
}

describe("signed storage relay", () => {
  it("streams the object through the server without exposing the signed URL", async () => {
    seenRange = null;
    const response = await call();
    expect(response.status).toBe(200);
    // A redirect would hand the bearer URL to the browser and break the page CSP.
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("inline");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await response.arrayBuffer()).equals(BODY)).toBe(true);
    expect(seenRange).toBeNull();
  });

  it("forwards Range requests and relays 206 metadata", async () => {
    seenRange = null;
    const response = await call({ rangeHeader: "bytes=10-109" });
    expect(response.status).toBe(206);
    expect(seenRange).toBe("bytes=10-109");
    expect(response.headers.get("content-range")).toBe(`bytes 10-109/${BODY.length}`);
    expect(response.headers.get("content-length")).toBe("100");
    expect(Buffer.from(await response.arrayBuffer()).equals(BODY.subarray(10, 110))).toBe(true);
  });

  it("answers 502 when the signed URL cannot be read", async () => {
    denyNext = true;
    try {
      await expect(call()).rejects.toBeInstanceOf(AppError);
      await expect(call()).rejects.toMatchObject({ code: "storage_unavailable", status: 502 });
    } finally {
      denyNext = false;
    }
  });
});
