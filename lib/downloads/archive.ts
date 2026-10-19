import JSZip from "jszip";
import type { Readable as NodeReadableStream } from "node:stream";
import { sanitizeFilename, uniqueArchiveEntryName } from "@/lib/security/filenames";
import type { ShareItemSummary } from "@/types";

/**
 * Archive (ZIP) generation helpers.
 *
 * Entry selection is a pure function so it can be unit tested; the builder
 * streams the archive and enforces a hard byte budget.
 */

export interface ArchiveFileEntry {
  kind: "file";
  itemId: string;
  storageKey: string;
  /** Entry name inside the archive. */
  name: string;
  sizeBytes: number;
}

export interface ArchiveTextEntry {
  kind: "text";
  itemId: string;
  name: string;
  content: string;
}

export type ArchiveEntry = ArchiveFileEntry | ArchiveTextEntry;

export interface ArchiveItemInput {
  id: string;
  type: "code" | "text" | "file";
  title: string;
  language: string | null;
  content: string | null;
  storageKey: string | null;
  originalFilename: string | null;
  sizeBytes: number | null;
}

const EXTENSION_BY_LANGUAGE: Record<string, string> = {
  plaintext: "txt",
  javascript: "js",
  typescript: "ts",
  jsx: "jsx",
  tsx: "tsx",
  python: "py",
  java: "java",
  c: "c",
  cpp: "cpp",
  csharp: "cs",
  go: "go",
  rust: "rs",
  php: "php",
  html: "html",
  css: "css",
  json: "json",
  sql: "sql",
  bash: "sh",
  yaml: "yaml",
  markdown: "md",
};

/** Sanitized archive base name for an item title (no path components). */
function safeBase(title: string): string {
  const cleaned = sanitizeFilename(title, "item")
    .replace(/[^A-Za-z0-9._ -]+/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return cleaned === "" ? "item" : cleaned;
}

/** True when a title already looks like a filename with an extension. */
function hasFileExtension(title: string): boolean {
  return /\.[A-Za-z0-9]{1,8}$/.test(title.trim());
}

/**
 * Plan archive entries for the file/text/code items of a share.
 * - file items are included as-is (by storage key)
 * - code/text items are included as text files named after their titles;
 *   titles that already carry an extension ("snippet.ts") are kept verbatim,
 *   otherwise one is derived from the language/format ("main" -> "main.js")
 * - names are sanitized and de-duplicated
 * - only items explicitly provided are included (caller must pass authorized
 *   items of a single share)
 */
export function planArchiveEntries(items: ArchiveItemInput[]): ArchiveEntry[] {
  const used = new Set<string>();
  const entries: ArchiveEntry[] = [];

  for (const item of items) {
    if (item.type === "file") {
      if (!item.storageKey) continue; // defensive: DB constraint already forbids this
      const name = uniqueArchiveEntryName(
        item.originalFilename ?? `${safeBase(item.title)}.bin`,
        used,
      );
      entries.push({
        kind: "file",
        itemId: item.id,
        storageKey: item.storageKey,
        name,
        sizeBytes: item.sizeBytes ?? 0,
      });
      continue;
    }

    let rawName: string;
    if (hasFileExtension(item.title)) {
      rawName = safeBase(item.title);
    } else {
      const extension =
        item.type === "code"
          ? (EXTENSION_BY_LANGUAGE[item.language ?? "plaintext"] ?? "txt")
          : /^#|\n#/.test(item.content ?? "") && item.title.toLowerCase().includes("readme")
            ? "md"
            : "txt";
      rawName = `${safeBase(item.title)}.${extension}`;
    }
    const name = uniqueArchiveEntryName(rawName, used);
    entries.push({ kind: "text", itemId: item.id, name, content: item.content ?? "" });
  }

  return entries;
}

export interface ArchivePlanLimits {
  maxTotalBytes: number;
  maxEntries: number;
}

export interface ArchivePlanProblem {
  reason: "entries" | "bytes";
  limit: number;
  actual: number;
}

/** Validate an entry plan against limits before reading any file bytes. */
export function validateArchivePlan(
  entries: ArchiveEntry[],
  limits: ArchivePlanLimits,
): ArchivePlanProblem | null {
  if (entries.length > limits.maxEntries) {
    return { reason: "entries", limit: limits.maxEntries, actual: entries.length };
  }
  const totalBytes = entries.reduce(
    (sum, entry) =>
      sum + (entry.kind === "file" ? entry.sizeBytes : Buffer.byteLength(entry.content, "utf8")),
    0,
  );
  if (totalBytes > limits.maxTotalBytes) {
    return { reason: "bytes", limit: limits.maxTotalBytes, actual: totalBytes };
  }
  return null;
}

export interface BuiltArchive {
  stream: ReadableStream<Uint8Array>;
  entries: number;
}

/**
 * Build the ZIP archive as a stream.
 * `readFile` loads a single object at a time; memory stays bounded by the
 * per-file limit plus JSZip's working set.
 */
export async function buildArchiveStream(
  entries: ArchiveEntry[],
  readFile: (storageKey: string) => Promise<Uint8Array | null>,
): Promise<BuiltArchive> {
  const zip = new JSZip();

  for (const entry of entries) {
    if (entry.kind === "text") {
      zip.file(entry.name, entry.content);
      continue;
    }
    const bytes = await readFile(entry.storageKey);
    if (!bytes) continue; // object missing: skip rather than fail the whole archive
    zip.file(entry.name, bytes);
  }

  const stream = zip.generateNodeStream({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    streamFiles: true,
  });

  const { Readable } = await import("node:stream");
  const webStream = Readable.toWeb(
    stream as unknown as NodeReadableStream,
  ) as ReadableStream<Uint8Array>;
  return { stream: webStream, entries: entries.length };
}

export function summarizeArchiveInput(items: ShareItemSummary[]): { files: number; texts: number } {
  return {
    files: items.filter((item) => item.type === "file").length,
    texts: items.filter((item) => item.type !== "file").length,
  };
}
