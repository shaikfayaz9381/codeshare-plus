import { describe, expect, it } from "vitest";

import { describeRemaining, formatBytes, formatDateTime, truncate } from "@/lib/format";

/**
 * Presentation helpers. These are rendered by both the server and the client,
 * so the formatting must be deterministic (UTC, fixed locale) — otherwise React
 * hydration would warn about mismatched text.
 */

describe("formatBytes", () => {
  it("renders whole bytes below 1 KiB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("scales to KiB, MiB and GiB with sensible precision", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10 * 1024)).toBe("10 KB");
    expect(formatBytes(1.25 * 1024 * 1024)).toBe("1.25 MB");
    expect(formatBytes(250 * 1024 * 1024)).toBe("250 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3 GB");
  });

  it("normalises invalid input to a dash instead of NaN", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("formats UTC timestamps with an explicit label", () => {
    expect(formatDateTime("2026-10-19T09:41:00.000Z")).toBe("19 Oct 2026, 09:41 UTC");
  });

  it("returns a dash for missing or unparsable values", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("not-a-date")).toBe("—");
  });
});

describe("describeRemaining", () => {
  const now = new Date("2026-10-19T12:00:00.000Z");

  it("describes a link that never expires", () => {
    expect(describeRemaining(null, now)).toBe("Never expires");
  });

  it("describes remaining lifetimes at each scale", () => {
    expect(describeRemaining("2026-10-19T11:59:00.000Z", now)).toBe("Expired");
    expect(describeRemaining("2026-10-19T12:00:30.000Z", now)).toBe("Less than a minute left");
    expect(describeRemaining("2026-10-19T12:30:00.000Z", now)).toBe("30 min left");
    expect(describeRemaining("2026-10-19T18:00:00.000Z", now)).toBe("6 h left");
    expect(describeRemaining("2026-10-25T12:00:00.000Z", now)).toBe("6 d left");
  });

  it("treats an unparsable expiry as unknown", () => {
    expect(describeRemaining("nope", now)).toBe("Unknown");
  });
});

describe("truncate", () => {
  it("keeps short values intact and shortens long ones", () => {
    expect(truncate("short")).toBe("short");
    expect(truncate("a".repeat(80), 10)).toBe("aaaaaaaaa…");
    expect(truncate("a".repeat(80), 10)).toHaveLength(10);
  });
});
