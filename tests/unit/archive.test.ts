import { describe, expect, it } from "vitest";
import {
  planArchiveEntries,
  summarizeArchiveInput,
  validateArchivePlan,
  type ArchiveItemInput,
} from "@/lib/downloads/archive";
import type { ShareItemSummary } from "@/types";

function item(
  overrides: Partial<ArchiveItemInput> & Pick<ArchiveItemInput, "id" | "type" | "title">,
): ArchiveItemInput {
  return {
    language: null,
    content: null,
    storageKey: null,
    originalFilename: null,
    sizeBytes: null,
    ...overrides,
  };
}

describe("planArchiveEntries", () => {
  it("keeps original filenames for uploaded files", () => {
    const entries = planArchiveEntries([
      item({
        id: "1",
        type: "file",
        title: "pixel",
        storageKey: "k",
        originalFilename: "pixel.png",
        sizeBytes: 5,
      }),
    ]);
    expect(entries).toEqual([
      { kind: "file", itemId: "1", storageKey: "k", name: "pixel.png", sizeBytes: 5 },
    ]);
  });

  it("derives an extension from the language for code items", () => {
    const entries = planArchiveEntries([
      item({ id: "1", type: "code", title: "main", content: "x", language: "javascript" }),
      item({ id: "2", type: "code", title: "util", content: "y", language: "python" }),
      item({ id: "3", type: "code", title: "notes", content: "z", language: null }),
      item({ id: "4", type: "code", title: "odd", content: "z", language: "brainfuck" }),
    ]);
    expect(entries.map((entry) => entry.name)).toEqual([
      "main.js",
      "util.py",
      "notes.txt",
      "odd.txt",
    ]);
  });

  it("keeps a filename that already carries an extension", () => {
    const entries = planArchiveEntries([
      item({ id: "1", type: "text", title: "snippet.ts", content: "export const x = 1;" }),
      item({
        id: "2",
        type: "code",
        title: "main.js",
        content: "console.log(1)",
        language: "javascript",
      }),
      item({ id: "3", type: "text", title: "notes", content: "plain text" }),
      item({ id: "4", type: "text", title: "README", content: "# Getting started" }),
    ]);
    expect(entries.map((entry) => entry.name)).toEqual([
      "snippet.ts",
      "main.js",
      "notes.txt",
      "README.md",
    ]);
  });

  it("sanitizes traversal attempts and de-duplicates names", () => {
    const entries = planArchiveEntries([
      item({ id: "1", type: "text", title: "../../etc/passwd", content: "x" }),
      item({ id: "2", type: "text", title: "notes", content: "x" }),
      item({ id: "3", type: "text", title: "notes.txt", content: "x" }),
    ]);
    expect(entries.map((entry) => entry.name)).toEqual([
      "passwd.txt",
      "notes.txt",
      "notes (2).txt",
    ]);
  });

  it("skips file items without a storage key", () => {
    const entries = planArchiveEntries([
      item({ id: "1", type: "file", title: "ghost", storageKey: null }),
    ]);
    expect(entries).toEqual([]);
  });
});

describe("validateArchivePlan", () => {
  const limits = { maxTotalBytes: 100, maxEntries: 2 };

  it("accepts plans within limits", () => {
    const entries = planArchiveEntries([
      item({ id: "1", type: "text", title: "a", content: "12345" }),
      item({ id: "2", type: "file", title: "b", storageKey: "k", sizeBytes: 10 }),
    ]);
    expect(validateArchivePlan(entries, limits)).toBeNull();
  });

  it("reports entry and byte overflows", () => {
    const many = planArchiveEntries(
      Array.from({ length: 3 }, (_, i) =>
        item({ id: String(i), type: "text", title: `t${i}`, content: "x" }),
      ),
    );
    expect(validateArchivePlan(many, limits)).toEqual({ reason: "entries", limit: 2, actual: 3 });

    const heavy = planArchiveEntries([
      item({ id: "1", type: "file", title: "big", storageKey: "k", sizeBytes: 101 }),
    ]);
    expect(validateArchivePlan(heavy, limits)).toEqual({
      reason: "bytes",
      limit: 100,
      actual: 101,
    });

    const heavyText = planArchiveEntries([
      item({ id: "1", type: "text", title: "t", content: "x".repeat(200) }),
    ]);
    expect(validateArchivePlan(heavyText, limits)?.reason).toBe("bytes");
  });
});

describe("summarizeArchiveInput", () => {
  it("counts files and text items", () => {
    const items = [{ type: "file" }, { type: "code" }, { type: "text" }] as ShareItemSummary[];
    expect(summarizeArchiveInput(items)).toEqual({ files: 1, texts: 2 });
  });
});
