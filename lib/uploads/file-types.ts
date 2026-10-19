import "server-only";
import { fileTypeFromBuffer } from "file-type";
import { extensionOf } from "@/lib/security/filenames";

/**
 * Server-side file type detection.
 *
 * The client-declared MIME type is never trusted. We sniff magic bytes with
 * `file-type` and fall back to conservative extension+content heuristics for
 * text formats.
 *
 * Never-render-trusted types (HTML, SVG, XML, JS) are classified as
 * `download-only`, which means they can only ever be served as attachments.
 */

export type FileClassification =
  | "image"
  | "pdf"
  | "archive"
  | "audio"
  | "video"
  | "text"
  | "markdown"
  | "csv"
  | "download-only"
  | "unknown";

/** MIME types that may be previewed inline in the browser. */
const INLINE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/tiff",
]);

const ARCHIVE_TYPES = new Set([
  "application/zip",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "application/gzip",
  "application/x-tar",
  "application/x-bzip2",
  "application/x-xz",
  "application/zstd",
]);

/** Types that must never be rendered inline (active content). */
const NEVER_INLINE_TYPES = new Set([
  "image/svg+xml",
  "text/html",
  "application/xhtml+xml",
  "text/xml",
  "application/xml",
  "application/javascript",
  "text/javascript",
  "application/x-httpd-php",
]);

const TEXT_EXTENSIONS = new Set([
  "txt",
  "text",
  "log",
  "md",
  "markdown",
  "mdx",
  "csv",
  "tsv",
  "json",
  "json5",
  "jsonc",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "env",
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "tsx",
  "py",
  "rb",
  "php",
  "java",
  "kt",
  "kts",
  "c",
  "h",
  "cc",
  "cpp",
  "cxx",
  "hpp",
  "cs",
  "go",
  "rs",
  "swift",
  "scala",
  "lua",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "bat",
  "cmd",
  "sql",
  "graphql",
  "gql",
  "prisma",
  "proto",
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  "styl",
  "xml",
  "svg",
  "vue",
  "svelte",
  "astro",
  "elm",
  "dockerfile",
  "makefile",
  "gradle",
  "tf",
  "hcl",
  "diff",
  "patch",
  "tex",
  "r",
  "m",
]);

/** Extension -> served/stored MIME type (only text-ish types; always safe). */
const TEXT_MIME_BY_EXTENSION: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  mdx: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  yaml: "application/yaml",
  yml: "application/yaml",
  toml: "application/toml",
  xml: "text/xml",
  svg: "image/svg+xml",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  jsx: "text/javascript",
  ts: "text/plain",
  tsx: "text/plain",
};

const MAX_SNIFF_BYTES = 4100;

export interface DetectedFile {
  /** Stored MIME type: sniffed when available, otherwise inferred/conservative. */
  mimeType: string;
  classification: FileClassification;
  /** True when the sniffed bytes matched a known signature. */
  sniffed: boolean;
  /** True when the content looks like binary data (NUL bytes present). */
  binary: boolean;
}

function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, MAX_SNIFF_BYTES));
  for (let i = 0; i < sample.length; i += 1) {
    if (sample[i] === 0) return false;
  }
  return true;
}

/**
 * Content-based markup detection for files whose extension lies: an HTML
 * document named `notes.txt` has no magic bytes, but must never be served or
 * previewed as trusted markup.
 */
function detectMarkupType(bytes: Uint8Array): string | null {
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, 512))
    .replace(/^\uFEFF/, "")
    .trimStart()
    .toLowerCase();
  if (
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    head.startsWith("<head") ||
    head.startsWith("<body")
  ) {
    return "text/html";
  }
  if (head.startsWith("<svg")) return "image/svg+xml";
  if (head.startsWith("<?xml") || head.startsWith("<xml")) return "text/xml";
  return null;
}

/**
 * Detect the stored type of a file from its leading bytes and filename.
 * `head` should contain at least the first 4 KiB of the object.
 */
export async function detectFile(head: Uint8Array, filename: string): Promise<DetectedFile> {
  const bytes = head.subarray(0, Math.min(head.length, MAX_SNIFF_BYTES));
  const extension = extensionOf(filename);
  const text = looksLikeText(bytes);

  const detected = await fileTypeFromBuffer(bytes).catch(() => null);

  if (detected) {
    let mime = detected.mime.toLowerCase();
    // `file-type` reports SVG documents as application/xml. When the file is
    // genuinely an SVG, keep the precise type (still never rendered inline).
    if ((mime === "application/xml" || mime === "text/xml") && extension === "svg") {
      mime = "image/svg+xml";
    }
    if (NEVER_INLINE_TYPES.has(mime)) {
      return { mimeType: mime, classification: "download-only", sniffed: true, binary: !text };
    }
    if (INLINE_IMAGE_TYPES.has(mime)) {
      return { mimeType: mime, classification: "image", sniffed: true, binary: true };
    }
    if (mime === "application/pdf") {
      return { mimeType: mime, classification: "pdf", sniffed: true, binary: true };
    }
    if (ARCHIVE_TYPES.has(mime)) {
      return { mimeType: mime, classification: "archive", sniffed: true, binary: true };
    }
    if (mime.startsWith("audio/")) {
      return { mimeType: mime, classification: "audio", sniffed: true, binary: true };
    }
    if (mime.startsWith("video/")) {
      return { mimeType: mime, classification: "video", sniffed: true, binary: true };
    }
    if (mime.startsWith("image/")) {
      // Unlisted image format: allow download, never inline.
      return { mimeType: mime, classification: "download-only", sniffed: true, binary: true };
    }
    if (mime.startsWith("text/")) {
      return { mimeType: mime, classification: "text", sniffed: true, binary: false };
    }
    return { mimeType: mime, classification: "unknown", sniffed: true, binary: true };
  }

  // No signature match: only treat as text when the extension is text-like AND
  // the content contains no NUL bytes.
  if (TEXT_EXTENSIONS.has(extension) && text) {
    // A text-ish extension can still hide markup ("page.txt" containing HTML).
    // Such files are always download-only, never previewed inline.
    const markup = detectMarkupType(bytes);
    if (markup) {
      return { mimeType: markup, classification: "download-only", sniffed: false, binary: false };
    }
    const mime = TEXT_MIME_BY_EXTENSION[extension] ?? "text/plain";
    if (NEVER_INLINE_TYPES.has(mime)) {
      return { mimeType: mime, classification: "download-only", sniffed: false, binary: false };
    }
    if (extension === "md" || extension === "markdown" || extension === "mdx") {
      return { mimeType: mime, classification: "markdown", sniffed: false, binary: false };
    }
    if (extension === "csv") {
      return { mimeType: mime, classification: "csv", sniffed: false, binary: false };
    }
    if (extension === "tsv") {
      return { mimeType: mime, classification: "csv", sniffed: false, binary: false };
    }
    return { mimeType: mime, classification: "text", sniffed: false, binary: false };
  }

  return {
    mimeType: "application/octet-stream",
    classification: "unknown",
    sniffed: false,
    binary: !text,
  };
}

/**
 * Classify an *existing* item for preview purposes using stored metadata.
 * Used by the preview endpoint (no re-sniffing needed for large files).
 */
export function classifyStoredFile(
  mimeType: string | null,
  filename: string,
  sizeBytes: number,
): FileClassification {
  void sizeBytes;
  const mime = (mimeType ?? "").toLowerCase();
  const extension = extensionOf(filename);

  if (NEVER_INLINE_TYPES.has(mime)) return "download-only";
  if (INLINE_IMAGE_TYPES.has(mime)) return "image";
  if (mime === "application/pdf") return "pdf";
  if (ARCHIVE_TYPES.has(mime)) return "archive";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "download-only";
  if (
    mime === "text/markdown" ||
    extension === "md" ||
    extension === "markdown" ||
    extension === "mdx"
  )
    return "markdown";
  if (
    mime === "text/csv" ||
    mime === "text/tab-separated-values" ||
    extension === "csv" ||
    extension === "tsv"
  )
    return "csv";
  if (mime.startsWith("text/") || mime === "application/json" || mime === "application/yaml")
    return "text";
  if (extension === "svg" || extension === "html" || extension === "htm") return "download-only";
  return "unknown";
}

export { INLINE_IMAGE_TYPES, NEVER_INLINE_TYPES, ARCHIVE_TYPES };
