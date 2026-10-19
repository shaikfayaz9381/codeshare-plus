import { describe, expect, it } from "vitest";
import {
  canDownloadShare,
  canEditShare,
  canManageShare,
  evaluateAccess,
  grantSecretHash,
  guestTokenHash,
  type AccessRelevantShare,
} from "@/lib/permissions/access";
import { newShareId, newToken } from "@/lib/security/ids";
import { sha256Hex } from "@/lib/security/digest";
import type { Actor } from "@/types";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

const guestTokenA = newToken();
const guestTokenB = newToken();
const guestActorA: Actor = { kind: "guest", tokenHash: guestTokenHash(guestTokenA) };
const guestActorB: Actor = { kind: "guest", tokenHash: guestTokenHash(guestTokenB) };
const userActor: Actor = { kind: "user", userId: OWNER_ID };
const otherUserActor: Actor = { kind: "user", userId: OTHER_ID };
const anonymous: Actor = { kind: "anonymous" };

function share(overrides: Partial<AccessRelevantShare> = {}): AccessRelevantShare {
  return {
    ownerId: null,
    guestOwnerTokenHash: null,
    hasPassword: false,
    expiresAt: null,
    revokedAt: null,
    allowDownload: true,
    allowEdit: false,
    ...overrides,
  };
}

describe("evaluateAccess", () => {
  const now = new Date("2026-06-01T12:00:00.000Z");

  it("reports missing shares", () => {
    expect(evaluateAccess(null, { hasPasswordGrant: false, now })).toBe("not_found");
  });

  it("applies precedence: revoked > expired > password", () => {
    // Revoked wins even when also expired and password protected.
    expect(
      evaluateAccess(
        share({
          revokedAt: new Date("2026-05-01T00:00:00.000Z"),
          expiresAt: new Date("2026-05-02T00:00:00.000Z"),
          hasPassword: true,
        }),
        { hasPasswordGrant: false, now },
      ),
    ).toBe("revoked");

    // Expired wins over password prompts.
    expect(
      evaluateAccess(
        share({ expiresAt: new Date("2026-05-31T00:00:00.000Z"), hasPassword: true }),
        {
          hasPasswordGrant: false,
          now,
        },
      ),
    ).toBe("expired");

    expect(evaluateAccess(share({ hasPassword: true }), { hasPasswordGrant: false, now })).toBe(
      "password_required",
    );
  });

  it("grants access with a valid password grant", () => {
    expect(evaluateAccess(share({ hasPassword: true }), { hasPasswordGrant: true, now })).toBe(
      "ok",
    );
    // A grant does not bypass expiry.
    expect(
      evaluateAccess(
        share({ hasPassword: true, expiresAt: new Date("2026-01-01T00:00:00.000Z") }),
        {
          hasPasswordGrant: true,
          now,
        },
      ),
    ).toBe("expired");
  });

  it("lets the share's manager read it without a password grant", () => {
    // Owners (authenticated or via the guest capability) hold management
    // rights, so setting a password must not lock them out of their own share.
    expect(
      evaluateAccess(share({ hasPassword: true }), {
        hasPasswordGrant: false,
        isManager: true,
        now,
      }),
    ).toBe("ok");

    // A manager bypass does not override revocation or expiry.
    expect(
      evaluateAccess(
        share({ hasPassword: true, revokedAt: new Date("2026-01-01T00:00:00.000Z") }),
        {
          hasPasswordGrant: false,
          isManager: true,
          now,
        },
      ),
    ).toBe("revoked");
    expect(
      evaluateAccess(
        share({ hasPassword: true, expiresAt: new Date("2026-01-01T00:00:00.000Z") }),
        {
          hasPasswordGrant: false,
          isManager: true,
          now,
        },
      ),
    ).toBe("expired");
  });

  it("allows unprotected, unexpired, unrevoked shares", () => {
    expect(evaluateAccess(share(), { hasPasswordGrant: false, now })).toBe("ok");
    expect(
      evaluateAccess(share({ expiresAt: new Date("2026-06-02T00:00:00.000Z") }), {
        hasPasswordGrant: false,
        now,
      }),
    ).toBe("ok");
  });
});

describe("canManageShare", () => {
  it("requires a matching owner", () => {
    expect(canManageShare(share({ ownerId: OWNER_ID }), userActor)).toBe(true);
    expect(canManageShare(share({ ownerId: OWNER_ID }), otherUserActor)).toBe(false);
    expect(canManageShare(share({ ownerId: OTHER_ID }), userActor)).toBe(false);
    expect(canManageShare(share({ ownerId: null }), userActor)).toBe(false);
    expect(canManageShare(null, userActor)).toBe(false);
  });

  it("matches guest capability hashes, never raw tokens", () => {
    const shareRow = share({ guestOwnerTokenHash: sha256Hex(guestTokenA) });
    expect(canManageShare(shareRow, guestActorA)).toBe(true);
    expect(canManageShare(shareRow, guestActorB)).toBe(false);
    expect(canManageShare(share({ guestOwnerTokenHash: null }), guestActorA)).toBe(false);
    // An authenticated user cannot manage a guest-owned share.
    expect(canManageShare(shareRow, userActor)).toBe(false);
  });

  it("denies anonymous callers", () => {
    expect(canManageShare(share({ ownerId: OWNER_ID }), anonymous)).toBe(false);
    expect(canManageShare(share({ guestOwnerTokenHash: sha256Hex(guestTokenA) }), anonymous)).toBe(
      false,
    );
  });
});

describe("canEditShare", () => {
  it("allows owners and guest holders only", () => {
    expect(canEditShare(share({ ownerId: OWNER_ID }), userActor)).toBe(true);
    expect(canEditShare(share({ guestOwnerTokenHash: sha256Hex(guestTokenA) }), guestActorA)).toBe(
      true,
    );
    expect(canEditShare(share({ ownerId: OTHER_ID }), userActor)).toBe(false);
    expect(canEditShare(share({ guestOwnerTokenHash: sha256Hex(guestTokenA) }), guestActorB)).toBe(
      false,
    );
    expect(canEditShare(null, userActor)).toBe(false);
  });

  it("does not treat the allowEdit flag as a capability", () => {
    expect(canEditShare(share({ ownerId: OWNER_ID, allowEdit: true }), anonymous)).toBe(false);
    expect(
      canEditShare(
        share({ guestOwnerTokenHash: sha256Hex(guestTokenA), allowEdit: true }),
        guestActorB,
      ),
    ).toBe(false);
  });
});

describe("canDownloadShare", () => {
  it("follows the share flag and fails closed for missing shares", () => {
    expect(canDownloadShare(share({ allowDownload: true }))).toBe(true);
    expect(canDownloadShare(share({ allowDownload: false }))).toBe(false);
    expect(canDownloadShare(null)).toBe(false);
  });
});

describe("token hashing helpers", () => {
  it("hashes guest tokens and grant secrets without reversible data", () => {
    const token = newToken();
    const shareId = newShareId();
    expect(guestTokenHash(token)).toBe(sha256Hex(token));
    expect(grantSecretHash(token)).toBe(sha256Hex(token));
    expect(guestTokenHash(token)).not.toContain(token);
    expect(shareId).not.toContain("=");
  });
});
