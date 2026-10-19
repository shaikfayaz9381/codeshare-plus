import { describe, expect, it } from "vitest";
import { sha256Hex, safeEqualHex, safeEqualString, privacyHash } from "@/lib/security/digest";
import { newShareId, newToken } from "@/lib/security/ids";
import {
  computeExpiresAt,
  describeExpiry,
  isExpired,
  isExpiryOption,
  DEFAULT_EXPIRY,
  EXPIRY_MS,
} from "@/lib/security/expiry";
import {
  cookieOptions,
  clearCookie,
  parseGrantsCookie,
  serializeCookie,
  serializeGrantsCookie,
  upsertGrantCookie,
  GRANTS_COOKIE_NAME,
} from "@/lib/security/cookies";
import {
  DUMMY_BCRYPT_HASH,
  PASSWORD_MAX_LENGTH,
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} from "@/lib/security/passwords";

const BCRYPT_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

describe("identifiers and tokens", () => {
  it("generates 128-bit URL-safe share ids", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const id = newShareId();
      expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
      // 22 base64url characters decode back to exactly 16 bytes.
      expect(Buffer.from(id, "base64url")).toHaveLength(16);
      ids.add(id);
    }
    expect(ids.size).toBe(500);
  });

  it("generates 256-bit capability tokens", () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(newToken()).not.toBe(token);
  });
});

describe("digests", () => {
  it("hashes deterministically with SHA-256", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
    expect(sha256Hex("abc")).not.toBe(sha256Hex("abd"));
  });

  it("compares digests safely", () => {
    expect(safeEqualHex(sha256Hex("x"), sha256Hex("x"))).toBe(true);
    expect(safeEqualHex(sha256Hex("x"), sha256Hex("y"))).toBe(false);
    expect(safeEqualHex("short", sha256Hex("x"))).toBe(false);
    expect(safeEqualHex("", "")).toBe(false);
    expect(safeEqualString("token", "token")).toBe(true);
    expect(safeEqualString("token", "other")).toBe(false);
  });

  it("salts privacy hashes so raw values never appear", () => {
    const hashed = privacyHash("203.0.113.9|vitest");
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed).toBe(privacyHash("203.0.113.9|vitest"));
    expect(hashed).not.toBe(privacyHash("203.0.113.10|vitest"));
    expect(hashed).not.toContain("203.0.113.9");
  });
});

describe("expiry", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("recognizes valid options", () => {
    for (const option of ["1h", "24h", "7d", "30d", "never"]) {
      expect(isExpiryOption(option)).toBe(true);
    }
    for (const option of ["2h", "", "NEVER", null, 7]) {
      expect(isExpiryOption(option)).toBe(false);
    }
  });

  it("computes absolute expiry timestamps", () => {
    expect(computeExpiresAt("1h", now)?.toISOString()).toBe("2026-01-01T01:00:00.000Z");
    expect(computeExpiresAt("24h", now)?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
    expect(computeExpiresAt("30d", now)?.getTime()).toBe(now.getTime() + EXPIRY_MS["30d"]);
    expect(computeExpiresAt("never", now)).toBeNull();
  });

  it("treats missing dates as never-expiring and malformed dates as expired", () => {
    expect(isExpired(null, now)).toBe(false);
    expect(isExpired(undefined, now)).toBe(false);
    expect(isExpired(new Date("2025-12-31T23:59:59.999Z"), now)).toBe(true);
    expect(isExpired(new Date("2026-01-01T00:00:00.001Z"), now)).toBe(false);
    // Exactly at the boundary counts as expired.
    expect(isExpired(new Date(now.getTime()), now)).toBe(true);
    expect(isExpired("not-a-date", now)).toBe(true);
    expect(isExpired("2027-01-01T00:00:00.000Z", now)).toBe(false);
  });

  it("describes remaining lifetime", () => {
    expect(describeExpiry(null, now)).toBe("Never expires");
    expect(describeExpiry(new Date(now.getTime() - 1000), now)).toBe("Expired");
    expect(describeExpiry(new Date(now.getTime() + 30_000), now)).toBe("1 min left");
    expect(describeExpiry(new Date(now.getTime() + 5 * 3_600_000), now)).toBe("5 h left");
    expect(describeExpiry(new Date(now.getTime() + 3 * 86_400_000), now)).toBe("3 d left");
  });

  it("defaults new shares to a 7 day lifetime", () => {
    expect(DEFAULT_EXPIRY).toBe("7d");
  });
});

describe("password hashing", () => {
  it("hashes with bcrypt and verifies correctly", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(BCRYPT_PATTERN);
    expect(hash).not.toContain("correct horse");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("fails closed on malformed hashes instead of throwing", async () => {
    expect(await verifyPassword("whatever", "not-a-hash")).toBe(false);
    expect(await verifyPassword("whatever", "")).toBe(false);
  });

  it("ships a valid dummy hash for timing-equalization", async () => {
    expect(DUMMY_BCRYPT_HASH).toMatch(BCRYPT_PATTERN);
    expect(await verifyPassword("any candidate", DUMMY_BCRYPT_HASH)).toBe(false);
  });

  it("validates password strength by character count", () => {
    expect(validatePasswordStrength("1234567").ok).toBe(false);
    expect(validatePasswordStrength("12345678").ok).toBe(true);
    expect(validatePasswordStrength("a".repeat(PASSWORD_MAX_LENGTH)).ok).toBe(true);
    expect(validatePasswordStrength("a".repeat(PASSWORD_MAX_LENGTH + 1)).ok).toBe(false);
    // Multi-byte characters count as one character each.
    expect(validatePasswordStrength("🔐".repeat(8)).ok).toBe(true);
    expect(validatePasswordStrength(undefined as unknown as string).ok).toBe(false);
  });
});

describe("cookies", () => {
  it("parses well-formed grant entries and drops malformed ones", () => {
    const grantId = "6f1a3d2e-1111-4222-8333-444455556666";
    const secret = "s".repeat(43);
    const map = parseGrantsCookie(`abc_DEF-1234567890:${grantId}.${secret}`);
    expect(map.get("abc_DEF-1234567890")).toEqual({ grantId, secret });

    expect(parseGrantsCookie("").size).toBe(0);
    expect(parseGrantsCookie(undefined).size).toBe(0);
    expect(parseGrantsCookie("missing-colon").size).toBe(0);
    expect(parseGrantsCookie(`short:${grantId}.${secret}`).size).toBe(0);
    expect(parseGrantsCookie(`abc_DEF-1234567890:not-a-uuid.${secret}`).size).toBe(0);
    expect(parseGrantsCookie(`abc_DEF-1234567890:${grantId}.short`).size).toBe(0);
    expect(parseGrantsCookie(`abc_DEF-1234567890:${grantId}`).size).toBe(0);
  });

  it("caps cookie size and keeps per-share entries unique", () => {
    const grantId = "6f1a3d2e-1111-4222-8333-444455556666";
    const secret = "s".repeat(43);
    const entries = Array.from(
      { length: 30 },
      (_, i) => `share-${String(i).padStart(12, "0")}:${grantId}.${secret}`,
    );
    const map = parseGrantsCookie(entries.join("|"));
    expect(map.size).toBe(20);

    const replaced = upsertGrantCookie(map, "share-000000000000", {
      grantId,
      secret: "z".repeat(43),
    });
    const reparsed = parseGrantsCookie(replaced);
    expect(reparsed.size).toBe(20);
    expect(reparsed.get("share-000000000000")?.secret).toBe("z".repeat(43));

    // Round-trips through serialization unchanged.
    expect(parseGrantsCookie(serializeGrantsCookie(reparsed)).size).toBe(20);
  });

  it("serializes hardened cookie attributes", () => {
    const header = serializeCookie(GRANTS_COOKIE_NAME, "a|b", cookieOptions(600));
    expect(header).toContain(`${GRANTS_COOKIE_NAME}=a%7Cb`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain("Max-Age=600");
    expect(header).not.toContain("Secure"); // dev/test defaults to non-secure cookies
    expect(cookieOptions(600, { secure: true }).secure).toBe(true);
    expect(clearCookie(GRANTS_COOKIE_NAME)).toContain("Max-Age=0");
  });
});
