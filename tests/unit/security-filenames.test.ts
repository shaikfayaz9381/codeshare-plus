import { describe, expect, it } from "vitest";
import {
  buildItemStorageKey,
  buildReservationStorageKey,
  extensionOf,
  isValidStorageKey,
  sanitizeFilename,
  shareUuidFromStorageKey,
  uniqueArchiveEntryName,
} from "@/lib/security/filenames";

const UUID = "0f0f0f0f-1111-4222-8333-444455556666";

describe("sanitizeFilename", () => {
  it("removes directory components on both separators", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\me\\secret.txt")).toBe("secret.txt");
    expect(sanitizeFilename("/var/tmp/file.log")).toBe("file.log");
    expect(sanitizeFilename("..\\..\\boot.ini")).toBe("boot.ini");
  });

  it("strips control characters and collapses whitespace", () => {
    expect(sanitizeFilename("a\u0000b\u001fc.txt")).toBe("abc.txt");
    expect(sanitizeFilename("my   file \t name.txt")).toBe("my file name.txt");
    expect(sanitizeFilename("trailing.  ")).toBe("trailing.");
  });

  it("neutralizes Windows device names and hidden-file prefixes", () => {
    expect(sanitizeFilename("CON")).toBe("_CON");
    expect(sanitizeFilename("con.txt")).toBe("_con.txt");
    expect(sanitizeFilename("LPT1")).toBe("_LPT1");
    expect(sanitizeFilename(".env")).toBe("env");
    expect(sanitizeFilename("...hidden")).toBe("hidden");
  });

  it("falls back for empty results and truncates long names keeping the extension", () => {
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename("   ")).toBe("file");
    expect(sanitizeFilename("...")).toBe("file");
    expect(sanitizeFilename("", "upload")).toBe("upload");

    const long = `${"a".repeat(400)}.tar.gz`;
    const result = sanitizeFilename(long);
    expect(result.length).toBeLessThanOrEqual(180);
    expect(result.endsWith(".gz")).toBe(true);
  });
});

describe("extensionOf", () => {
  it("returns the lowercase extension or an empty string", () => {
    expect(extensionOf("image.PNG")).toBe("png");
    expect(extensionOf("archive.tar.gz")).toBe("gz");
    expect(extensionOf("no-extension")).toBe("");
    expect(extensionOf("trailing.")).toBe("");
    // Dotfiles (`env`, `gitignore`) have no extension.
    expect(extensionOf(".env")).toBe("");
  });
});

describe("storage keys", () => {
  it("builds canonical, collision-free keys", () => {
    const key = buildItemStorageKey(UUID, UUID, "my report 2026.pdf");
    expect(key).toBe(`shares/${UUID}/${UUID}/my_report_2026.pdf`);
    expect(isValidStorageKey(key)).toBe(true);

    const reserved = buildReservationStorageKey(UUID, UUID, "photo.webp");
    expect(reserved).toBe(`shares/${UUID}/uploads/${UUID}/photo.webp`);
    expect(isValidStorageKey(reserved)).toBe(true);
  });

  it("never lets user filenames escape the share prefix", () => {
    const key = buildItemStorageKey(UUID, UUID, "../../../etc/passwd");
    expect(key.startsWith(`shares/${UUID}/${UUID}/`)).toBe(true);
    expect(key).not.toContain("..");
    expect(isValidStorageKey(key)).toBe(true);
  });

  it("rejects non-canonical keys", () => {
    expect(isValidStorageKey(`shares/${UUID}/${UUID}/ok.png`)).toBe(true);
    expect(isValidStorageKey(`shares/${UUID}/${UUID}/`)).toBe(false);
    expect(isValidStorageKey(`shares/${UUID}/../secret.txt`)).toBe(false);
    expect(isValidStorageKey(`/shares/${UUID}/${UUID}/a.png`)).toBe(false);
    expect(isValidStorageKey(`shares/${UUID}/${UUID}/a\\b.png`)).toBe(false);
    expect(isValidStorageKey(`shares/${UUID.toUpperCase()}/${UUID}/a.png`)).toBe(false);
    expect(isValidStorageKey(`shares/${UUID}/${UUID}/nested/a.png`)).toBe(false);
    expect(isValidStorageKey("")).toBe(false);
  });

  it("extracts the owning share uuid", () => {
    expect(shareUuidFromStorageKey(`shares/${UUID}/x/y.png`)).toBe(UUID);
    expect(shareUuidFromStorageKey(`shares/${UUID}/uploads/x/y.png`)).toBe(UUID);
    expect(shareUuidFromStorageKey("other/prefix.png")).toBeNull();
  });
});

describe("uniqueArchiveEntryName", () => {
  it("sanitizes names and de-duplicates case-insensitively", () => {
    const used = new Set<string>();
    expect(uniqueArchiveEntryName("report.pdf", used)).toBe("report.pdf");
    expect(uniqueArchiveEntryName("report.pdf", used)).toBe("report (2).pdf");
    expect(uniqueArchiveEntryName("REPORT.PDF", used)).toBe("REPORT (3).PDF");
    expect(uniqueArchiveEntryName("../../etc/passwd", used)).toBe("passwd");
    expect(uniqueArchiveEntryName("", used)).toBe("file");
  });
});
