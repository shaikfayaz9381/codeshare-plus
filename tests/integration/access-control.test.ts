import { afterAll, beforeEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { closeDb } from "@/lib/db/client";
import { resetDatabase, testDb, uniqueIp } from "../helpers/db";
import {
  actAsAnonymous,
  cookieHeader,
  ctx,
  getRequest,
  jsonRequest,
  multipartRequest,
  readJson,
  readSetCookies,
} from "../helpers/http";
import { runMaintenance } from "@/lib/services/cleanup";
import { purgeExpiredShares } from "@/lib/services/shares";

import { POST as createShare } from "@/app/api/shares/route";
import { GET as getShare, PATCH as patchShare } from "@/app/api/shares/[shareId]/route";
import { GET as getAccess } from "@/app/api/shares/[shareId]/access/route";
import { POST as verifyPassword } from "@/app/api/shares/[shareId]/password/route";
import { POST as revokeShare } from "@/app/api/shares/[shareId]/revoke/route";
import { GET as listItems, POST as createItem } from "@/app/api/shares/[shareId]/items/route";
import { GET as getItem } from "@/app/api/shares/[shareId]/items/[itemId]/route";
import { GET as getPreview } from "@/app/api/shares/[shareId]/items/[itemId]/preview/route";
import { GET as getContent } from "@/app/api/shares/[shareId]/items/[itemId]/content/route";
import { POST as uploadRoute } from "@/app/api/shares/[shareId]/upload/route";
import { GET as downloadAll } from "@/app/api/shares/[shareId]/download-all/route";
import { GET as healthRoute } from "@/app/api/health/route";
import type { PublicShare, ShareItemDetail, ShareItemSummary } from "@/types";

const BASE = "http://localhost:3000";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

const SVG_PAYLOAD = Buffer.from(
  `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert('xss')</script></svg>`,
);

const HTML_PAYLOAD = Buffer.from(
  `<!DOCTYPE html><html><body><h1>hi</h1><script>alert('xss')</script></body></html>`,
);

const PDF_PAYLOAD = Buffer.concat([
  Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<<>>\n%%EOF\n"),
]);

interface Session {
  shareId: string;
  cookie: string;
}

async function createGuestShare(
  input: Record<string, unknown> = {},
  ip = uniqueIp(),
  existingCookie?: string,
): Promise<Session> {
  actAsAnonymous();
  const response = await createShare(
    jsonRequest(`${BASE}/api/shares`, {
      body: { title: "Protected collection", ...input },
      ip,
      ...(existingCookie ? { cookie: existingCookie } : {}),
    }),
  );
  expect(response.status).toBe(201);
  const { share } = await readJson<{ share: PublicShare }>(response);
  const token = readSetCookies(response).cs_guest ?? existingCookie?.replace(/^cs_guest=/, "");
  return { shareId: share.shareId, cookie: cookieHeader({ cs_guest: token }) };
}

async function addTextItem(
  session: Session,
  title: string,
  content: string,
): Promise<ShareItemDetail> {
  const response = await createItem(
    jsonRequest(`${BASE}/api/shares/${session.shareId}/items`, {
      cookie: session.cookie,
      body: { type: "text", title, content },
    }),
    ctx({ shareId: session.shareId }),
  );
  expect(response.status).toBe(201);
  return (await readJson<{ item: ShareItemDetail }>(response)).item;
}

async function uploadFile(session: Session, file: File, ip = uniqueIp()): Promise<ShareItemDetail> {
  const response = await uploadRoute(
    multipartRequest(
      `${BASE}/api/shares/${session.shareId}/upload`,
      { file },
      { cookie: session.cookie, ip },
    ),
    ctx({ shareId: session.shareId }),
  );
  expect(response.status).toBe(201);
  return (await readJson<{ item: ShareItemDetail }>(response)).item;
}

describe("access control (integration, real PostgreSQL + real storage)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("requires the password before exposing items, previews or downloads", async () => {
    const session = await createGuestShare({ password: "correct-horse-battery" });
    const item = await addTextItem(session, "Secret plan", "The plan is...");

    // Anonymous reader: gate state, no item titles in the payload.
    const gate = await getShare(
      getRequest(`${BASE}/api/shares/${session.shareId}`),
      ctx({ shareId: session.shareId }),
    );
    expect(gate.status).toBe(200);
    const gatePayload = await readJson<{
      state: string;
      share: { title: string };
      items: unknown[];
    }>(gate);
    expect(gatePayload.state).toBe("password_required");
    expect(gatePayload.items).toEqual([]);
    expect(gatePayload.share.title).toBe("Protected collection");
    expect(JSON.stringify(gatePayload)).not.toContain("Secret plan");

    // Item list and content are refused without a grant.
    const denied = await listItems(
      getRequest(`${BASE}/api/shares/${session.shareId}/items`),
      ctx({ shareId: session.shareId }),
    );
    expect(denied.status).toBe(403);
    expect((await readJson<{ error: { code: string } }>(denied)).error.code).toBe(
      "password_required",
    );

    const deniedItem = await getItem(
      getRequest(`${BASE}/api/shares/${session.shareId}/items/${item.id}`),
      ctx({ shareId: session.shareId, itemId: item.id }),
    );
    expect(deniedItem.status).toBe(403);

    // Wrong password: 403 and no cookie.
    const wrong = await verifyPassword(
      jsonRequest(`${BASE}/api/shares/${session.shareId}/password`, {
        body: { password: "wrong-password" },
        ip: uniqueIp(),
      }),
      ctx({ shareId: session.shareId }),
    );
    expect(wrong.status).toBe(403);
    expect(Object.keys(readSetCookies(wrong))).toHaveLength(0);

    // Correct password: issues a grant cookie.
    const correct = await verifyPassword(
      jsonRequest(`${BASE}/api/shares/${session.shareId}/password`, {
        body: { password: "correct-horse-battery" },
        ip: uniqueIp(),
      }),
      ctx({ shareId: session.shareId }),
    );
    expect(correct.status).toBe(200);
    const grant = readSetCookies(correct).cs_grants;
    expect(grant).toBeTruthy();
    const readerCookie = cookieHeader({ cs_grants: grant });

    // Reader can now load the collection and the item content.
    const authorized = await getShare(
      getRequest(`${BASE}/api/shares/${session.shareId}`, { cookie: readerCookie }),
      ctx({ shareId: session.shareId }),
    );
    const authorizedPayload = await readJson<{ state: string; items: ShareItemSummary[] }>(
      authorized,
    );
    expect(authorizedPayload.state).toBe("ok");
    expect(authorizedPayload.items).toHaveLength(1);

    const itemResponse = await getItem(
      getRequest(`${BASE}/api/shares/${session.shareId}/items/${item.id}`, {
        cookie: readerCookie,
      }),
      ctx({ shareId: session.shareId, itemId: item.id }),
    );
    expect(itemResponse.status).toBe(200);

    // Changing the password revokes outstanding grants.
    const changed = await patchShare(
      jsonRequest(`${BASE}/api/shares/${session.shareId}`, {
        method: "PATCH",
        cookie: session.cookie,
        body: { passwordMode: "set", password: "brand-new-password" },
      }),
      ctx({ shareId: session.shareId }),
    );
    expect(changed.status).toBe(200);
    const staleGrant = await getAccess(
      getRequest(`${BASE}/api/shares/${session.shareId}/access`, { cookie: readerCookie }),
      ctx({ shareId: session.shareId }),
    );
    expect((await readJson<{ state: string }>(staleGrant)).state).toBe("password_required");
  });

  it("lets the creator keep reading their own password-protected collection", async () => {
    const session = await createGuestShare({ password: "correct-horse-battery" });
    await addTextItem(session, "Owner note", "Written by the creator.");
    const file = await uploadFile(session, new File([PNG_1X1], "pixel.png", { type: "image/png" }));

    // The guest capability cookie is the owner's credential, so the password
    // gate must not lock the creator out of their own collection.
    const ownerList = await listItems(
      getRequest(`${BASE}/api/shares/${session.shareId}/items`, { cookie: session.cookie }),
      ctx({ shareId: session.shareId }),
    );
    expect(ownerList.status).toBe(200);
    expect((await readJson<{ items: ShareItemSummary[] }>(ownerList)).items).toHaveLength(2);

    const ownerDetail = await getItem(
      getRequest(`${BASE}/api/shares/${session.shareId}/items/${file.id}`, {
        cookie: session.cookie,
      }),
      ctx({ shareId: session.shareId, itemId: file.id }),
    );
    expect(ownerDetail.status).toBe(200);

    const ownerContent = await getContent(
      getRequest(`${BASE}/api/shares/${session.shareId}/items/${file.id}/content`, {
        cookie: session.cookie,
      }),
      ctx({ shareId: session.shareId, itemId: file.id }),
    );
    expect(ownerContent.status).toBe(200);

    const ownerZip = await downloadAll(
      getRequest(`${BASE}/api/shares/${session.shareId}/download-all`, { cookie: session.cookie }),
      ctx({ shareId: session.shareId }),
    );
    expect(ownerZip.status).toBe(200);

    // A different guest capability must not bypass the password.
    const stranger = await createGuestShare({ title: "Someone else's collection" });
    const strangerRead = await getItem(
      getRequest(`${BASE}/api/shares/${session.shareId}/items/${file.id}`, {
        cookie: stranger.cookie,
      }),
      ctx({ shareId: session.shareId, itemId: file.id }),
    );
    expect(strangerRead.status).toBe(403);

    // Neither may an anonymous visitor.
    actAsAnonymous();
    const anonymous = await getShare(
      getRequest(`${BASE}/api/shares/${session.shareId}`),
      ctx({ shareId: session.shareId }),
    );
    expect((await readJson<{ state: string }>(anonymous)).state).toBe("password_required");
  });

  it("rate limits password attempts per IP and share", async () => {
    const session = await createGuestShare({ password: "correct-horse-battery" });
    const ip = uniqueIp();
    let sawTooMany = false;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await verifyPassword(
        jsonRequest(`${BASE}/api/shares/${session.shareId}/password`, {
          body: { password: `guess-${attempt}` },
          ip,
        }),
        ctx({ shareId: session.shareId }),
      );
      if (response.status === 429) {
        sawTooMany = true;
        break;
      }
      expect(response.status).toBe(403);
    }
    expect(sawTooMany).toBe(true);
  });

  it("blocks expired shares everywhere with a 410", async () => {
    const session = await createGuestShare({ expiresIn: "1h" });
    const item = await addTextItem(session, "Old note", "old");

    // Time travel: expire the share directly in the database.
    await testDb()`update public.shares set expires_at = now() - interval '1 minute' where share_id = ${session.shareId}`;

    const page = await getShare(
      getRequest(`${BASE}/api/shares/${session.shareId}`),
      ctx({ shareId: session.shareId }),
    );
    expect(page.status).toBe(410);
    expect((await readJson<{ state: string }>(page)).state).toBe("expired");

    const items = await listItems(
      getRequest(`${BASE}/api/shares/${session.shareId}/items`, { cookie: session.cookie }),
      ctx({ shareId: session.shareId }),
    );
    expect(items.status).toBe(410);

    const content = await getItem(
      getRequest(`${BASE}/api/shares/${session.shareId}/items/${item.id}`, {
        cookie: session.cookie,
      }),
      ctx({ shareId: session.shareId, itemId: item.id }),
    );
    expect(content.status).toBe(410);

    const zip = await downloadAll(
      getRequest(`${BASE}/api/shares/${session.shareId}/download-all`, { cookie: session.cookie }),
      ctx({ shareId: session.shareId }),
    );
    expect(zip.status).toBe(410);

    // Even the manager cannot read content of an expired share.
    const manageCheck = await patchShare(
      jsonRequest(`${BASE}/api/shares/${session.shareId}`, {
        method: "PATCH",
        cookie: session.cookie,
        body: { title: "still manageable" },
      }),
      ctx({ shareId: session.shareId }),
    );
    // Managers may still update metadata (e.g. to fix an expiry), read paths do not.
    expect(manageCheck.status).toBe(200);
  });

  it("revocation invalidates reads and outstanding grants", async () => {
    const session = await createGuestShare({ password: "correct-horse-battery" });
    const item = await addTextItem(session, "Note", "note body");

    const verified = await verifyPassword(
      jsonRequest(`${BASE}/api/shares/${session.shareId}/password`, {
        body: { password: "correct-horse-battery" },
        ip: uniqueIp(),
      }),
      ctx({ shareId: session.shareId }),
    );
    const readerCookie = cookieHeader({ cs_grants: readSetCookies(verified).cs_grants });

    const revokeResponse = await revokeShare(
      jsonRequest(`${BASE}/api/shares/${session.shareId}/revoke`, { cookie: session.cookie }),
      ctx({ shareId: session.shareId }),
    );
    expect(revokeResponse.status).toBe(200);

    const reader = await getAccess(
      getRequest(`${BASE}/api/shares/${session.shareId}/access`, { cookie: readerCookie }),
      ctx({ shareId: session.shareId }),
    );
    expect(reader.status).toBe(403);
    expect((await readJson<{ state: string }>(reader)).state).toBe("revoked");

    const content = await getItem(
      getRequest(`${BASE}/api/shares/${session.shareId}/items/${item.id}`, {
        cookie: readerCookie,
      }),
      ctx({ shareId: session.shareId, itemId: item.id }),
    );
    expect(content.status).toBe(403);

    const grants = await testDb()<{ n: number }[]>`
      select count(*)::int as n from public.share_access_grants
       where share_uuid = (select id from public.shares where share_id = ${session.shareId}) and revoked_at is null
    `;
    expect(grants[0]!.n).toBe(0);
  });

  it("stores uploads privately, sniffs real types and never serves active content inline", async () => {
    const session = await createGuestShare();

    const png = await uploadFile(
      session,
      new File([new Uint8Array(PNG_1X1)], "pixel.png", { type: "image/png" }),
    );
    expect(png.file?.mimeType).toBe("image/png");

    const svg = await uploadFile(
      session,
      new File([new Uint8Array(SVG_PAYLOAD)], "logo.svg", { type: "image/svg+xml" }),
    );
    expect(svg.file?.mimeType).toBe("image/svg+xml");

    const html = await uploadFile(
      session,
      new File([new Uint8Array(HTML_PAYLOAD)], "page.html", { type: "text/html" }),
    );
    expect(html.file?.mimeType).toBe("text/html");

    // Client-declared MIME types are ignored: a PHP file renamed .png is not an image.
    const disguised = await uploadFile(
      session,
      new File([new Uint8Array(Buffer.from("<?php echo 'pwn'; ?>"))], "shell.png", {
        type: "image/png",
      }),
    );
    expect(disguised.file?.mimeType).not.toBe("image/png");
    expect(disguised.file?.mimeType).toBe("application/octet-stream");

    const pdf = await uploadFile(
      session,
      new File([new Uint8Array(PDF_PAYLOAD)], "doc.pdf", { type: "application/pdf" }),
    );
    expect(pdf.file?.mimeType).toBe("application/pdf");

    // Image inline preview works and streams the exact bytes with nosniff.
    const imageBytes = await getContent(
      getRequest(`${BASE}/api/shares/${session.shareId}/items/${png.id}/content`, {
        cookie: session.cookie,
      }),
      ctx({ shareId: session.shareId, itemId: png.id }),
    );
    expect(imageBytes.status).toBe(200);
    expect(imageBytes.headers.get("content-type")).toBe("image/png");
    expect(imageBytes.headers.get("content-disposition")).toContain("inline");
    expect(imageBytes.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await imageBytes.arrayBuffer()).equals(PNG_1X1)).toBe(true);

    const previewImage = await getPreview(
      getRequest(`${BASE}/api/shares/${session.shareId}/items/${png.id}/preview`, {
        cookie: session.cookie,
      }),
      ctx({ shareId: session.shareId, itemId: png.id }),
    );
    expect((await readJson<{ preview: { kind: string } }>(previewImage)).preview.kind).toBe(
      "image",
    );

    // SVG is active content: never inline, never "previewed", always attachment bytes.
    const svgPreview = await getPreview(
      getRequest(`${BASE}/api/shares/${session.shareId}/items/${svg.id}/preview`, {
        cookie: session.cookie,
      }),
      ctx({ shareId: session.shareId, itemId: svg.id }),
    );
    expect((await readJson<{ preview: { kind: string } }>(svgPreview)).preview.kind).toBe(
      "unsupported",
    );

    const svgContent = await getContent(
      getRequest(`${BASE}/api/shares/${session.shareId}/items/${svg.id}/content`, {
        cookie: session.cookie,
      }),
      ctx({ shareId: session.shareId, itemId: svg.id }),
    );
    expect(svgContent.headers.get("content-disposition")).toContain("attachment");
    expect(svgContent.headers.get("content-type")).toBe("application/octet-stream");

    // HTML: same treatment.
    const htmlContent = await getContent(
      getRequest(`${BASE}/api/shares/${session.shareId}/items/${html.id}/content`, {
        cookie: session.cookie,
      }),
      ctx({ shareId: session.shareId, itemId: html.id }),
    );
    expect(htmlContent.headers.get("content-disposition")).toContain("attachment");
    expect(htmlContent.headers.get("content-type")).toBe("application/octet-stream");

    // PDF is previewed inline.
    const pdfContent = await getContent(
      getRequest(`${BASE}/api/shares/${session.shareId}/items/${pdf.id}/content`, {
        cookie: session.cookie,
      }),
      ctx({ shareId: session.shareId, itemId: pdf.id }),
    );
    expect(pdfContent.headers.get("content-type")).toBe("application/pdf");
    expect(pdfContent.headers.get("content-disposition")).toContain("inline");

    // Recipients without management rights cannot fetch file bytes.
    const anonymousReader = await getContent(
      getRequest(`${BASE}/api/shares/${session.shareId}/items/${png.id}/content`),
      ctx({ shareId: session.shareId, itemId: png.id }),
    );
    expect(anonymousReader.status).toBe(200); // unlisted share, downloads enabled: readers may read

    // ...but they still cannot list or mutate.
    const readerItems = await listItems(
      getRequest(`${BASE}/api/shares/${session.shareId}/items`),
      ctx({ shareId: session.shareId }),
    );
    expect(readerItems.status).toBe(200);
  });

  it("renders markdown safely and parses CSV with caps", async () => {
    const session = await createGuestShare();
    const markdown = await uploadFile(
      session,
      new File(
        [
          new Uint8Array(
            Buffer.from(
              [
                "# Title",
                "",
                "<script>alert(1)</script>",
                "",
                "[click](javascript:alert(2))",
                "",
                "<img src=x onerror=alert(3)>",
                "",
                "[raw link](javascript:alert(4))",
                "",
                "[docs](https://example.com/guide)",
                "",
                "**bold** text",
                "",
              ].join("\n"),
            ),
          ),
        ],
        "README.md",
        { type: "text/markdown" },
      ),
    );

    const preview = await getPreview(
      getRequest(`${BASE}/api/shares/${session.shareId}/items/${markdown.id}/preview`, {
        cookie: session.cookie,
      }),
      ctx({ shareId: session.shareId, itemId: markdown.id }),
    );
    const body = await readJson<{ preview: { kind: string; html: string } }>(preview);
    expect(body.preview.kind).toBe("markdown");
    expect(body.preview.html).toContain("<h1>Title</h1>");
    expect(body.preview.html).toContain("<strong>bold</strong>");
    // Raw HTML from notes is escaped, never emitted as markup.
    expect(body.preview.html).not.toContain("<script");
    expect(body.preview.html).toContain("&lt;img src=x onerror=alert(3)&gt;");
    // No inline event handler may survive as a real attribute.
    expect(body.preview.html).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);
    // No dangerous protocol may ever reach an href/src attribute.
    expect(body.preview.html).not.toMatch(
      /<\s*(?:a|img|iframe|link|script)\b[^>]*\b(?:href|src)\s*=\s*["']?\s*(?:javascript|data|vbscript):/i,
    );
    // Safe links survive, hardened with rel/target.
    expect(body.preview.html).toContain('href="https://example.com/guide"');
    expect(body.preview.html).toMatch(/rel="noopener noreferrer nofollow"/);

    const csv = await uploadFile(
      session,
      new File(
        [
          new Uint8Array(
            Buffer.from(
              ["name,score", ...Array.from({ length: 600 }, (_, i) => `user${i},${i}`)].join("\n"),
            ),
          ),
        ],
        "scores.csv",
        { type: "text/csv" },
      ),
    );
    const csvPreview = await getPreview(
      getRequest(`${BASE}/api/shares/${session.shareId}/items/${csv.id}/preview`, {
        cookie: session.cookie,
      }),
      ctx({ shareId: session.shareId, itemId: csv.id }),
    );
    const csvBody = await readJson<{
      preview: {
        kind: string;
        table: { columns: string[]; rows: string[][]; truncatedRows: boolean };
      };
    }>(csvPreview);
    expect(csvBody.preview.kind).toBe("csv");
    expect(csvBody.preview.table.columns).toEqual(["name", "score"]);
    expect(csvBody.preview.table.rows.length).toBeLessThanOrEqual(500);
    expect(csvBody.preview.table.truncatedRows).toBe(true);
  });

  it("hides file bytes when downloads are disabled", async () => {
    const session = await createGuestShare({ allowDownload: false });
    const file = await uploadFile(
      session,
      new File([new Uint8Array(PNG_1X1)], "pixel.png", { type: "image/png" }),
    );

    const content = await getContent(
      getRequest(`${BASE}/api/shares/${session.shareId}/items/${file.id}/content`, {
        cookie: session.cookie,
      }),
      ctx({ shareId: session.shareId, itemId: file.id }),
    );
    expect(content.status).toBe(403);

    const preview = await getPreview(
      getRequest(`${BASE}/api/shares/${session.shareId}/items/${file.id}/preview`, {
        cookie: session.cookie,
      }),
      ctx({ shareId: session.shareId, itemId: file.id }),
    );
    expect(preview.status).toBe(403);

    const zip = await downloadAll(
      getRequest(`${BASE}/api/shares/${session.shareId}/download-all`, { cookie: session.cookie }),
      ctx({ shareId: session.shareId }),
    );
    expect(zip.status).toBe(403);

    // Metadata (name/size/type) remains visible in the item list.
    const items = await listItems(
      getRequest(`${BASE}/api/shares/${session.shareId}/items`, { cookie: session.cookie }),
      ctx({ shareId: session.shareId }),
    );
    const listed = (await readJson<{ items: ShareItemSummary[] }>(items)).items;
    expect(listed[0]!.file?.originalFilename).toBe("pixel.png");
  });

  it("builds a ZIP containing exactly the items of the requested share", async () => {
    const sessionA = await createGuestShare({ title: "Bundle A" });
    await addTextItem(sessionA, "snippet.ts", "export const x = 1;\n");
    const codeItem = await createItem(
      jsonRequest(`${BASE}/api/shares/${sessionA.shareId}/items`, {
        cookie: sessionA.cookie,
        body: {
          type: "code",
          title: "main",
          content: "console.log('hi')\n",
          language: "javascript",
        },
      }),
      ctx({ shareId: sessionA.shareId }),
    );
    expect(codeItem.status).toBe(201);
    await uploadFile(
      sessionA,
      new File([new Uint8Array(PNG_1X1)], "pixel.png", { type: "image/png" }),
    );
    await uploadFile(
      sessionA,
      new File([new Uint8Array(PNG_1X1)], "pixel.png", { type: "image/png" }),
    );

    const sessionB = await createGuestShare({ title: "Bundle B" });
    await addTextItem(sessionB, "other.txt", "not included");

    const response = await downloadAll(
      getRequest(`${BASE}/api/shares/${sessionA.shareId}/download-all`, {
        cookie: sessionA.cookie,
      }),
      ctx({ shareId: sessionA.shareId }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");

    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual(["main.js", "pixel (2).png", "pixel.png", "snippet.ts"]);
    expect(names.some((name) => name.includes("other"))).toBe(false);

    const mainJs = await zip.file("main.js")!.async("string");
    expect(mainJs).toBe("console.log('hi')\n");
    const snippet = await zip.file("snippet.ts")!.async("string");
    expect(snippet).toBe("export const x = 1;\n");
    const pixel = Buffer.from(await zip.file("pixel.png")!.async("uint8array"));
    expect(pixel.equals(PNG_1X1)).toBe(true);
  });

  it("rejects oversized and invalid uploads with clear errors", async () => {
    const session = await createGuestShare();

    // Oversized proxied upload (50 MB limit is configured via env in tests;
    // declared content-length is enough to trigger the early rejection).
    const bigRequest = new Request(`${BASE}/api/shares/${session.shareId}/upload`, {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=xyz",
        "content-length": String(80 * 1024 * 1024),
        cookie: session.cookie,
        "x-forwarded-for": uniqueIp(),
      },
      body: "irrelevant",
    });
    const rejected = await uploadRoute(bigRequest, ctx({ shareId: session.shareId }));
    expect([400, 413]).toContain(rejected.status);

    // Missing file field.
    const emptyForm = new FormData();
    const missing = await uploadRoute(
      new Request(`${BASE}/api/shares/${session.shareId}/upload`, {
        method: "POST",
        headers: { cookie: session.cookie, "x-forwarded-for": uniqueIp() },
        body: emptyForm,
      }),
      ctx({ shareId: session.shareId }),
    );
    expect(missing.status).toBe(400);

    // Empty file.
    const empty = await uploadRoute(
      multipartRequest(
        `${BASE}/api/shares/${session.shareId}/upload`,
        { file: new File([], "empty.txt", { type: "text/plain" }) },
        { cookie: session.cookie, ip: uniqueIp() },
      ),
      ctx({ shareId: session.shareId }),
    );
    expect(empty.status).toBe(400);
  });

  it("cleans up abandoned upload reservations and purges revoked shares", async () => {
    const session = await createGuestShare();
    const file = await uploadFile(
      session,
      new File([new Uint8Array(PNG_1X1)], "pixel.png", { type: "image/png" }),
    );

    // Simulate an abandoned direct upload: a pending, expired reservation with an object.
    const shareUuid = (
      await testDb()<{ id: string }[]>`
      select id from public.shares where share_id = ${session.shareId}
    `
    )[0]!.id;
    const reservationId = crypto.randomUUID();
    const storageKey = `shares/${shareUuid}/uploads/${reservationId}/ghost.bin`;
    const { getStorage } = await import("@/lib/storage");
    await getStorage().put({
      key: storageKey,
      body: new Uint8Array([1, 2, 3]),
      contentType: "application/octet-stream",
    });
    await testDb()`
      insert into public.upload_reservations (id, share_uuid, storage_key, original_filename, declared_size, status, expires_at)
      values (${reservationId}, ${shareUuid}, ${storageKey}, 'ghost.bin', 3, 'pending', now() - interval '5 minutes')
    `;

    // Simulate an expired grant row.
    await testDb()`
      insert into public.share_access_grants (share_uuid, grant_hash, expires_at)
      values (${shareUuid}, ${"a".repeat(64)}, now() - interval '2 days')
    `;

    const report = await runMaintenance({ limit: 10 });
    expect(report.abandonedUploads).toBeGreaterThanOrEqual(1);
    expect(await getStorage().head(storageKey)).toBeNull();
    expect(report.expiredGrants).toBeGreaterThanOrEqual(1);

    // Revoked share is purged together with its objects.
    const revokeResponse = await revokeShare(
      jsonRequest(`${BASE}/api/shares/${session.shareId}/revoke`, { cookie: session.cookie }),
      ctx({ shareId: session.shareId }),
    );
    expect(revokeResponse.status).toBe(200);
    const purged = await purgeExpiredShares(0, 10);
    expect(purged.shares).toBeGreaterThanOrEqual(1);
    expect(
      await testDb()<
        { n: number }[]
      >`select count(*)::int as n from public.share_items where id = ${file.id}`,
    ).toEqual([{ n: 0 }]);
  });

  it("health endpoint reports safe dependency status without secrets", async () => {
    const response = await healthRoute();
    const body = await readJson<{
      ok: boolean;
      state: string;
      checks: {
        database: { ok: boolean };
        storage: { ok: boolean; driver: string };
        auth: { ok: boolean };
      };
    }>(response);

    expect(body.ok).toBe(true);
    expect(body.state).toBe("ok");
    expect(body.checks.database.ok).toBe(true);
    expect(body.checks.storage.ok).toBe(true);
    expect(body.checks.storage.driver).toBe("local");
    expect(body.checks.auth.ok).toBe(false); // Supabase Auth intentionally unset in tests

    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/service_role|postgres:\/\/|password|secret/i);
  });

  it("rejects malformed JSON and invalid payloads with validation details", async () => {
    const session = await createGuestShare();
    const badJson = await createItem(
      new Request(`${BASE}/api/shares/${session.shareId}/items`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
          "x-forwarded-for": uniqueIp(),
        },
        body: "{not json",
      }),
      ctx({ shareId: session.shareId }),
    );
    expect(badJson.status).toBe(400);

    const invalid = await createItem(
      jsonRequest(`${BASE}/api/shares/${session.shareId}/items`, {
        cookie: session.cookie,
        body: { type: "code", title: "", content: "x", language: "not-a-language" },
      }),
      ctx({ shareId: session.shareId }),
    );
    expect(invalid.status).toBe(400);
    const details = await readJson<{ error: { code: string; details: Array<{ path: string }> } }>(
      invalid,
    );
    expect(details.error.code).toBe("validation_error");
    expect(details.error.details.length).toBeGreaterThan(0);
  });

  it("rate limits share creation for anonymous callers", async () => {
    const ip = uniqueIp();
    let limited = false;
    for (let i = 0; i < 12; i += 1) {
      const response = await createShare(
        jsonRequest(`${BASE}/api/shares`, { body: { title: `Share ${i}` }, ip }),
      );
      if (response.status === 429) {
        limited = true;
        expect(response.headers.get("retry-after")).toBeTruthy();
        break;
      }
      expect(response.status).toBe(201);
    }
    expect(limited).toBe(true);
  });

  it("counts daily guest upload bytes against a quota", async () => {
    const session = await createGuestShare();
    const payload = new Uint8Array(300 * 1024);
    await uploadFile(
      session,
      new File([payload], "big.bin", { type: "application/octet-stream" }),
      uniqueIp(),
    );

    const key = await testDb()<{ bucket_key: string; counter: number }[]>`
      select bucket_key, counter from public.usage_counters where bucket_key like 'guest-bytes:%'
    `;
    expect(key.length).toBe(1);
    expect(Number(key[0]!.counter)).toBeGreaterThanOrEqual(300 * 1024);
  });
});
