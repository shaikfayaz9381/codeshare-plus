import "server-only";
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";
import Papa from "papaparse";
import { limits } from "@/lib/config/env";
import { getStorage } from "@/lib/storage";
import { classifyStoredFile, type FileClassification } from "@/lib/uploads/file-types";
import type { ShareItemRow } from "@/lib/db/rows";
import type { CsvPreview, PreviewPayload } from "@/types";

/**
 * File preview preparation.
 *
 * Preview rules:
 *   - raster images / PDF / audio / video: metadata only; the browser streams
 *     the bytes through the authorized content endpoint (inline disposition).
 *   - text / code: read up to MAX_TEXT_PREVIEW_KB, decoded strictly as UTF-8.
 *   - markdown: parsed with HTML disabled, then sanitized with an allowlist.
 *   - CSV/TSV: parsed with row/column/depth caps; malformed input degrades to a
 *     readable error rather than a crash.
 *   - everything else (including HTML/SVG) is never previewed inline.
 *
 * Markdown HTML is generated here, on the server, from sanitized input; the
 * client renders the sanitized HTML only.
 */

const markdown = new MarkdownIt({
  html: false, // never trust or render raw HTML from notes
  linkify: true,
  breaks: false,
  typographer: false,
});

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "a",
    "p",
    "br",
    "hr",
    "strong",
    "em",
    "del",
    "s",
    "code",
    "pre",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "ul",
    "ol",
    "li",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "img",
    "span",
    "sup",
    "sub",
  ],
  allowedAttributes: {
    a: ["href", "title", "rel", "target"],
    img: ["src", "alt", "title", "width", "height"],
    code: ["class"],
    span: ["class"],
    th: ["align"],
    td: ["align"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesAppliedToAttributes: ["href", "src"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        rel: "noopener noreferrer nofollow",
        target: "_blank",
      },
    }),
  },
};

export function renderMarkdownToSafeHtml(source: string): string {
  const rendered = markdown.render(source);
  return sanitizeHtml(rendered, SANITIZE_OPTIONS);
}

const CSV_MAX_ROWS = 500;
const CSV_MAX_COLUMNS = 50;
const CSV_MAX_FIELD_CHARS = 8192;

export type { CsvPreview };

export function parseCsvText(
  text: string,
  options: { maxRows?: number; maxColumns?: number } = {},
): CsvPreview {
  const maxRows = options.maxRows ?? CSV_MAX_ROWS;
  const maxColumns = options.maxColumns ?? CSV_MAX_COLUMNS;

  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: "greedy",
    dynamicTyping: false,
    // +2 so the header row does not count against `maxRows` data rows while
    // still letting us detect truncation.
    preview: maxRows + 2,
  });

  const rawRows = (result.data ?? []).map((row) =>
    (Array.isArray(row) ? row : [String(row)]).map((cell) =>
      String(cell ?? "").slice(0, CSV_MAX_FIELD_CHARS),
    ),
  );

  const maxLines = maxRows + 1; // header + data rows
  const truncatedRows = rawRows.length > maxLines;
  const visible = rawRows.slice(0, maxLines);
  const columnCount = visible.reduce((max, row) => Math.max(max, row.length), 0);
  const truncatedColumns = columnCount > maxColumns;
  const width = Math.min(columnCount, maxColumns);

  const header = visible[0] ?? [];
  const columns = Array.from(
    { length: width },
    (_, index) => header[index] ?? `Column ${index + 1}`,
  );
  const rows = visible.slice(1).map((row) => {
    const padded = Array.from({ length: width }, (_, index) => row[index] ?? "");
    return padded;
  });

  return {
    columns,
    rows,
    rowCount: visible.length > 0 ? visible.length - 1 : 0,
    truncatedRows,
    truncatedColumns,
    parseErrors: result.errors?.length ?? 0,
  };
}

export type PreviewResponse = PreviewPayload;

const EXTENSION_LANGUAGE: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  go: "go",
  rs: "rust",
  php: "php",
  html: "html",
  htm: "html",
  css: "css",
  scss: "css",
  scsss: "css",
  json: "json",
  jsonc: "json",
  json5: "json",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  yml: "yaml",
  yaml: "yaml",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  xml: "plaintext",
  svg: "plaintext",
  ini: "plaintext",
  toml: "plaintext",
  conf: "plaintext",
  cfg: "plaintext",
  env: "plaintext",
  log: "plaintext",
  txt: "plaintext",
};

/** Map a filename to a CodeMirror language id (explicit fallback: plaintext). */
export function detectLanguageFromFilename(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_LANGUAGE[extension] ?? "plaintext";
}

/** Cheap content heuristic used when a file has no useful extension. */
export function detectLanguageFromContent(content: string): string {
  const head = content.slice(0, 2000);
  if (/^#!.*\b(node|python|bash|sh|zsh|ruby|php)\b/m.test(head)) {
    const match = /^#!.*\b(node|python|bash|sh|zsh|ruby|php)\b/m.exec(head);
    const interpreter = match?.[1];
    if (interpreter === "node") return "javascript";
    if (interpreter === "python") return "python";
    if (interpreter === "bash" || interpreter === "sh" || interpreter === "zsh") return "bash";
    if (interpreter === "ruby") return "plaintext";
    if (interpreter === "php") return "php";
  }
  if (/<\?php\b/.test(head)) return "php";
  if (/^\s*<!DOCTYPE html|<html[\s>]/i.test(head)) return "html";
  if (/^\s*\{[\s\S]*\}\s*$/.test(head)) {
    try {
      JSON.parse(content);
      return "json";
    } catch {
      /* not JSON */
    }
  }
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE TABLE|ALTER TABLE)\b/i.test(head)) return "sql";
  if (/^(import|export)\s.+from\s/m.test(head) || /^(const|let|var|function|class)\s/m.test(head))
    return "javascript";
  if (/^(def|class)\s+\w+.*:\s*$/m.test(head) || /^\s*import\s+\w+\s*$/m.test(head))
    return "python";
  return "plaintext";
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Office/OpenDocument formats cannot be rendered by browsers natively. A
 * type-aware message is more useful than a generic "no preview" for them.
 */
const DOCUMENT_MIME_LABELS: Array<[RegExp, string]> = [
  [/wordprocessingml|msword/, "Word document"],
  [/spreadsheetml|ms-excel/, "Spreadsheet"],
  [/presentationml|ms-powerpoint/, "Presentation"],
  [/opendocument\.text/, "OpenDocument text"],
  [/opendocument\.spreadsheet/, "OpenDocument spreadsheet"],
  [/opendocument\.presentation/, "OpenDocument presentation"],
  [/opendocument\.graphics|vnd\.visio/, "Document"],
  [/application\/rtf/, "Rich text document"],
];

const DOCUMENT_EXTENSION_LABELS: Record<string, string> = {
  doc: "Word document",
  docx: "Word document",
  odt: "OpenDocument text",
  rtf: "Rich text document",
  xls: "Spreadsheet",
  xlsx: "Spreadsheet",
  ods: "OpenDocument spreadsheet",
  ppt: "Presentation",
  pptx: "Presentation",
  odp: "OpenDocument presentation",
  vsd: "Document",
  vsdx: "Document",
  odg: "Document",
};

function documentKindLabel(mimeType: string | null, filename: string): string | null {
  const mime = (mimeType ?? "").toLowerCase();
  for (const [pattern, label] of DOCUMENT_MIME_LABELS) {
    if (pattern.test(mime)) return label;
  }
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return DOCUMENT_EXTENSION_LABELS[extension] ?? null;
}

export async function previewFileItem(item: ShareItemRow): Promise<PreviewResponse> {
  if (item.item_type !== "file" || !item.storage_key) {
    return { kind: "unsupported", reason: "Not a file item.", mimeType: null, sizeBytes: 0 };
  }
  const l = limits();
  const size = Number(item.size_bytes ?? 0);
  const filename = item.original_filename ?? "file";
  const classification: FileClassification = classifyStoredFile(item.mime_type, filename, size);

  switch (classification) {
    case "image":
    case "pdf":
    case "archive":
    case "audio":
    case "video":
      return { kind: classification, sizeBytes: size, mimeType: item.mime_type };
    case "download-only":
      return {
        kind: "unsupported",
        reason:
          "This file type can contain active content (HTML/SVG) and is never previewed inline. Download it to inspect it locally.",
        mimeType: item.mime_type,
        sizeBytes: size,
      };
    case "markdown": {
      if (size > l.maxMarkdownPreviewBytes) {
        return {
          kind: "text",
          text: "",
          truncated: true,
          language: "markdown",
          format: "markdown",
        };
      }
      const bytes = await getStorage().get(item.storage_key);
      if (!bytes)
        return {
          kind: "unsupported",
          reason: "Stored object not found.",
          mimeType: item.mime_type,
          sizeBytes: size,
        };
      const text = decodeUtf8(bytes);
      if (text === null) {
        return {
          kind: "unsupported",
          reason: "File is not valid UTF-8 text.",
          mimeType: item.mime_type,
          sizeBytes: size,
        };
      }
      return { kind: "markdown", html: renderMarkdownToSafeHtml(text), truncated: false };
    }
    case "csv": {
      if (size > l.maxCsvPreviewBytes) {
        return {
          kind: "unsupported",
          reason: `CSV preview is limited to ${Math.floor(l.maxCsvPreviewBytes / (1024 * 1024))} MB. Download the file instead.`,
          mimeType: item.mime_type,
          sizeBytes: size,
        };
      }
      const bytes = await getStorage().get(item.storage_key);
      if (!bytes)
        return {
          kind: "unsupported",
          reason: "Stored object not found.",
          mimeType: item.mime_type,
          sizeBytes: size,
        };
      const text = decodeUtf8(bytes);
      if (text === null) {
        return {
          kind: "unsupported",
          reason: "File is not valid UTF-8 text.",
          mimeType: item.mime_type,
          sizeBytes: size,
        };
      }
      const table = parseCsvText(text);
      return { kind: "csv", table, truncated: false };
    }
    case "text": {
      if (size > l.maxTextPreviewBytes) {
        return {
          kind: "unsupported",
          reason: `Text preview is limited to ${Math.floor(l.maxTextPreviewBytes / 1024)} KB. Download the file instead.`,
          mimeType: item.mime_type,
          sizeBytes: size,
        };
      }
      const bytes = await getStorage().get(item.storage_key);
      if (!bytes)
        return {
          kind: "unsupported",
          reason: "Stored object not found.",
          mimeType: item.mime_type,
          sizeBytes: size,
        };
      const text = decodeUtf8(bytes);
      if (text === null) {
        return {
          kind: "unsupported",
          reason: "File is not valid UTF-8 text.",
          mimeType: item.mime_type,
          sizeBytes: size,
        };
      }
      const language = detectLanguageFromFilename(filename);
      return { kind: "text", text, truncated: false, language, format: "text" };
    }
    default: {
      const label = documentKindLabel(item.mime_type, filename);
      return {
        kind: "unsupported",
        reason: label
          ? `${label} files can't be rendered in the browser. Download the file and open it in the matching app.`
          : "No inline preview is available for this file type.",
        mimeType: item.mime_type,
        sizeBytes: size,
      };
    }
  }
}
