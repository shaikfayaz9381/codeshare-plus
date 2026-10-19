import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/lib/db/client";
import { createTestUser, resetDatabase, uniqueIp } from "../helpers/db";
import {
  actAsAnonymous,
  actAsUser,
  cookieHeader,
  ctx,
  getRequest,
  jsonRequest,
  readJson,
  readSetCookies,
} from "../helpers/http";

import { POST as createShare } from "@/app/api/shares/route";
import { GET as listShares } from "@/app/api/shares/route";
import {
  DELETE as deleteShare,
  GET as getShare,
  PATCH as patchShare,
} from "@/app/api/shares/[shareId]/route";
import {
  GET as listItems,
  POST as createItem,
  PUT as reorderItems,
} from "@/app/api/shares/[shareId]/items/route";
import {
  DELETE as deleteItem,
  GET as getItem,
  PATCH as patchItem,
} from "@/app/api/shares/[shareId]/items/[itemId]/route";
import { GET as getDashboard } from "@/app/api/dashboard/route";
import type { PublicShare, ShareItemDetail, ShareItemSummary } from "@/types";

const BASE = "http://localhost:3000";

interface GuestSession {
  cookie: string;
  shareId: string;
}

async function createGuestShare(
  input: Record<string, unknown> = {},
  ip = uniqueIp(),
  existingCookie?: string,
): Promise<GuestSession> {
  actAsAnonymous();
  const response = await createShare(
    jsonRequest(`${BASE}/api/shares`, {
      body: { title: "Test collection", ...input },
      ip,
      ...(existingCookie ? { cookie: existingCookie } : {}),
    }),
  );
  expect(response.status).toBe(201);
  const body = await readJson<{ share: PublicShare }>(response);
  const cookies = readSetCookies(response);
  // A returning guest keeps its existing capability; a new browser gets one.
  const token = cookies.cs_guest ?? existingCookie?.replace(/^cs_guest=/, "");
  expect(token).toBeTruthy();
  return { cookie: cookieHeader({ cs_guest: token }), shareId: body.share.shareId };
}

describe("share lifecycle (integration, real PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("creates a share with a unique, unguessable public identifier", async () => {
    const a = await createGuestShare();
    const b = await createGuestShare();
    expect(a.shareId).not.toBe(b.shareId);
    expect(a.shareId).toMatch(/^[A-Za-z0-9_-]{20,24}$/);
    expect(a.shareId.length).toBeGreaterThanOrEqual(20);
  });

  it("honours a custom link, rejects duplicates with 409 and reserved names with 400", async () => {
    const custom = await createGuestShare({ customShareId: "Team-Notes" });
    expect(custom.shareId).toBe("team-notes");

    actAsAnonymous();
    const duplicate = await createShare(
      jsonRequest(`${BASE}/api/shares`, {
        body: { title: "Duplicate", customShareId: "team-notes" },
        ip: uniqueIp(),
      }),
    );
    expect(duplicate.status).toBe(409);
    const duplicateBody = await readJson<{ error: { code: string } }>(duplicate);
    expect(duplicateBody.error.code).toBe("conflict");

    const reserved = await createShare(
      jsonRequest(`${BASE}/api/shares`, {
        body: { title: "Reserved", customShareId: "api" },
        ip: uniqueIp(),
      }),
    );
    expect(reserved.status).toBe(400);

    const view = await getShare(
      getRequest(`${BASE}/api/shares/team-notes`, {}),
      ctx({ shareId: "team-notes" }),
    );
    expect(view.status).toBe(200);
    const viewed = await readJson<{ share: PublicShare }>(view);
    expect(viewed.share.shareId).toBe("team-notes");
  });

  it("stores multiple code and text items and returns them ordered", async () => {
    const { cookie, shareId } = await createGuestShare();

    const codeResponse = await createItem(
      jsonRequest(`${BASE}/api/shares/${shareId}/items`, {
        cookie,
        body: {
          type: "code",
          title: "hello.ts",
          content: "export const hello = () => 'world';\n",
          language: "typescript",
        },
      }),
      ctx({ shareId }),
    );
    expect(codeResponse.status).toBe(201);
    const code = (await readJson<{ item: ShareItemDetail }>(codeResponse)).item;
    expect(code.type).toBe("code");
    expect(code.language).toBe("typescript");

    const noteResponse = await createItem(
      jsonRequest(`${BASE}/api/shares/${shareId}/items`, {
        cookie,
        body: { type: "text", title: "Release notes", content: "Shipped v1." },
      }),
      ctx({ shareId }),
    );
    expect(noteResponse.status).toBe(201);
    const note = (await readJson<{ item: ShareItemDetail }>(noteResponse)).item;

    const list = await listItems(
      getRequest(`${BASE}/api/shares/${shareId}/items`, { cookie }),
      ctx({ shareId }),
    );
    expect(list.status).toBe(200);
    const items = (await readJson<{ items: ShareItemSummary[] }>(list)).items;
    expect(items.map((item) => item.title)).toEqual(["hello.ts", "Release notes"]);
    expect(items[0]!.position).toBe(0);
    expect(items[1]!.position).toBe(1);

    // Content survives round-trips unchanged (byte-for-byte).
    const fetched = await getItem(
      getRequest(`${BASE}/api/shares/${shareId}/items/${code.id}`, { cookie }),
      ctx({ shareId, itemId: code.id }),
    );
    const detail = (await readJson<{ item: ShareItemDetail }>(fetched)).item;
    expect(detail.content).toBe("export const hello = () => 'world';\n");

    // Reorder persists.
    const reordered = await reorderItems(
      jsonRequest(`${BASE}/api/shares/${shareId}/items`, {
        method: "PUT",
        cookie,
        body: { itemIds: [note.id, code.id] },
      }),
      ctx({ shareId }),
    );
    expect(reordered.status).toBe(200);
    const afterReorder = (await readJson<{ items: ShareItemSummary[] }>(reordered)).items;
    expect(afterReorder.map((item) => item.title)).toEqual(["Release notes", "hello.ts"]);
    expect(afterReorder.map((item) => item.position)).toEqual([0, 1]);
  });

  it("renames, edits and deletes items; rejects unknown item ids", async () => {
    const { cookie, shareId } = await createGuestShare();
    const created = await createItem(
      jsonRequest(`${BASE}/api/shares/${shareId}/items`, {
        cookie,
        body: { type: "code", title: "draft.py", content: "print('hi')\n", language: "python" },
      }),
      ctx({ shareId }),
    );
    const item = (await readJson<{ item: ShareItemDetail }>(created)).item;

    const patched = await patchItem(
      jsonRequest(`${BASE}/api/shares/${shareId}/items/${item.id}`, {
        method: "PATCH",
        cookie,
        body: { title: "final.py", content: "print('bye')\n" },
      }),
      ctx({ shareId, itemId: item.id }),
    );
    expect(patched.status).toBe(200);
    const updated = (await readJson<{ item: ShareItemDetail }>(patched)).item;
    expect(updated.title).toBe("final.py");
    expect(updated.content).toBe("print('bye')\n");

    const unknown = await getItem(
      getRequest(`${BASE}/api/shares/${shareId}/items/${crypto.randomUUID()}`, { cookie }),
      ctx({ shareId, itemId: crypto.randomUUID() }),
    );
    expect(unknown.status).toBe(404);

    const removed = await deleteItem(
      jsonRequest(`${BASE}/api/shares/${shareId}/items/${item.id}`, { method: "DELETE", cookie }),
      ctx({ shareId, itemId: item.id }),
    );
    expect(removed.status).toBe(204);

    const list = await listItems(
      getRequest(`${BASE}/api/shares/${shareId}/items`, { cookie }),
      ctx({ shareId }),
    );
    expect((await readJson<{ items: ShareItemSummary[] }>(list)).items).toHaveLength(0);
  });

  it("serves a saved collection to a fresh browser session with no management powers", async () => {
    const { cookie, shareId } = await createGuestShare();
    await createItem(
      jsonRequest(`${BASE}/api/shares/${shareId}/items`, {
        cookie,
        body: { type: "text", title: "Note", content: "Visible to recipients." },
      }),
      ctx({ shareId }),
    );

    // Fresh browser: no cookies at all.
    const anonymous = getRequest(`${BASE}/api/shares/${shareId}`);
    const response = await getShare(anonymous, ctx({ shareId }));
    expect(response.status).toBe(200);
    const payload = await readJson<{
      state: string;
      share: PublicShare;
      items: ShareItemSummary[];
      canManage: boolean;
      canEdit: boolean;
    }>(response);

    expect(payload.state).toBe("ok");
    expect(payload.share.title).toBe("Test collection");
    expect(payload.items).toHaveLength(1);
    expect(payload.canManage).toBe(false);
    expect(payload.canEdit).toBe(false);

    // A recipient can read the item content but cannot mutate anything.
    const item = payload.items[0]!;
    const read = await getItem(
      getRequest(`${BASE}/api/shares/${shareId}/items/${item.id}`),
      ctx({ shareId, itemId: item.id }),
    );
    expect(read.status).toBe(200);

    const denyPatch = await patchItem(
      jsonRequest(`${BASE}/api/shares/${shareId}/items/${item.id}`, {
        method: "PATCH",
        body: { title: "hacked" },
      }),
      ctx({ shareId, itemId: item.id }),
    );
    expect(denyPatch.status).toBe(404);

    const denyDelete = await deleteItem(
      jsonRequest(`${BASE}/api/shares/${shareId}/items/${item.id}`, { method: "DELETE" }),
      ctx({ shareId, itemId: item.id }),
    );
    expect(denyDelete.status).toBe(404);

    const denySharePatch = await patchShare(
      jsonRequest(`${BASE}/api/shares/${shareId}`, { method: "PATCH", body: { title: "stolen" } }),
      ctx({ shareId }),
    );
    expect(denySharePatch.status).toBe(404);

    const denyShareDelete = await deleteShare(
      jsonRequest(`${BASE}/api/shares/${shareId}`, { method: "DELETE" }),
      ctx({ shareId }),
    );
    expect(denyShareDelete.status).toBe(404);
  });

  it("does not expose storage keys, password hashes or guest token hashes", async () => {
    const { cookie, shareId } = await createGuestShare();
    await createItem(
      jsonRequest(`${BASE}/api/shares/${shareId}/items`, {
        cookie,
        body: { type: "text", title: "Secret note", content: "content" },
      }),
      ctx({ shareId }),
    );

    const response = await getShare(
      getRequest(`${BASE}/api/shares/${shareId}`, { cookie }),
      ctx({ shareId }),
    );
    const raw = JSON.stringify(await readJson(response));
    expect(raw).not.toMatch(/storage_key|password_hash|guest_owner_token_hash|grant_hash/);
    expect(raw).not.toContain("shares/");
  });

  it("keeps authenticated owners isolated from each other", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();

    actAsUser(userA);
    const created = await createShare(
      jsonRequest(`${BASE}/api/shares`, {
        body: { title: "A's notes", visibility: "unlisted" },
        ip: uniqueIp(),
      }),
    );
    expect(created.status).toBe(201);
    const shareA = (await readJson<{ share: PublicShare }>(created)).share;
    // No guest cookie is issued for authenticated owners.
    expect(readSetCookies(created).cs_guest).toBeUndefined();

    const itemResponse = await createItem(
      jsonRequest(`${BASE}/api/shares/${shareA.shareId}/items`, {
        body: { type: "code", title: "a.ts", content: "const a = 1;\n", language: "typescript" },
      }),
      ctx({ shareId: shareA.shareId }),
    );
    expect(itemResponse.status).toBe(201);
    const itemId = (await readJson<{ item: ShareItemDetail }>(itemResponse)).item.id;

    // Owner can manage.
    const ownerPatch = await patchShare(
      jsonRequest(`${BASE}/api/shares/${shareA.shareId}`, {
        method: "PATCH",
        body: { title: "A's notes v2" },
      }),
      ctx({ shareId: shareA.shareId }),
    );
    expect(ownerPatch.status).toBe(200);

    // Another signed-in user cannot.
    actAsUser(userB);
    const otherPatch = await patchShare(
      jsonRequest(`${BASE}/api/shares/${shareA.shareId}`, {
        method: "PATCH",
        body: { title: "B was here" },
      }),
      ctx({ shareId: shareA.shareId }),
    );
    expect(otherPatch.status).toBe(404);
    const otherDelete = await deleteItem(
      jsonRequest(`${BASE}/api/shares/${shareA.shareId}/items/${itemId}`, { method: "DELETE" }),
      ctx({ shareId: shareA.shareId, itemId }),
    );
    expect(otherDelete.status).toBe(404);

    // Dashboard lists only the caller's collections.
    actAsUser(userA);
    const dashboardAResponse = await getDashboard(getRequest(`${BASE}/api/dashboard`));
    actAsUser(userB);
    const dashboardB = await getDashboard(getRequest(`${BASE}/api/dashboard`));
    expect((await readJson<{ total: number }>(dashboardAResponse)).total).toBe(1);
    expect((await readJson<{ total: number }>(dashboardB)).total).toBe(0);

    // Guest listing without a capability is rejected.
    actAsAnonymous();
    const guestList = await listShares(getRequest(`${BASE}/api/shares`));
    expect(guestList.status).toBe(401);
  });

  it("supports guest dashboard listing through the capability cookie only", async () => {
    const first = await createGuestShare({ title: "Guest A" });
    // Same browser (reusing its capability cookie) creates a second share.
    const second = await createGuestShare({ title: "Guest B" }, uniqueIp(), first.cookie);
    expect(second.cookie).toBe(first.cookie);

    const withCookie = await listShares(getRequest(`${BASE}/api/shares`, { cookie: first.cookie }));
    expect(withCookie.status).toBe(200);
    const listed = await readJson<{ shares: Array<{ title: string }>; total: number }>(withCookie);
    expect(listed.total).toBe(2);
    expect(listed.shares.map((s) => s.title).sort()).toEqual(["Guest A", "Guest B"]);

    // A different browser (no cookie) sees nothing and cannot guess management.
    const withoutCookie = await listShares(getRequest(`${BASE}/api/shares`));
    expect(withoutCookie.status).toBe(401);
  });

  it("purges deleted shares and their items", async () => {
    const { cookie, shareId } = await createGuestShare();
    await createItem(
      jsonRequest(`${BASE}/api/shares/${shareId}/items`, {
        cookie,
        body: { type: "text", title: "temp", content: "temp" },
      }),
      ctx({ shareId }),
    );

    const deleted = await deleteShare(
      jsonRequest(`${BASE}/api/shares/${shareId}`, { method: "DELETE", cookie }),
      ctx({ shareId }),
    );
    expect(deleted.status).toBe(204);

    const missing = await getShare(getRequest(`${BASE}/api/shares/${shareId}`), ctx({ shareId }));
    expect(missing.status).toBe(404);
  });
});
