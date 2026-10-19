/**
 * Shared domain types for CodeShare Plus.
 *
 * These are the *public* shapes returned by the API and consumed by the UI.
 * They intentionally never contain storage keys, password hashes or
 * management-token hashes.
 */

export type ShareVisibility = "public" | "unlisted";
export type ShareItemType = "code" | "text" | "file";

export type ExpiryOption = "1h" | "24h" | "7d" | "30d" | "never";

export interface FileMeta {
  originalFilename: string;
  mimeType: string | null;
  sizeBytes: number;
}

/** Public representation of a share (safe for recipients). */
export interface PublicShare {
  /** Public, unguessable share identifier used in URLs. */
  shareId: string;
  title: string;
  description: string | null;
  visibility: ShareVisibility;
  hasPassword: boolean;
  expiresAt: string | null;
  allowDownload: boolean;
  allowEdit: boolean;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  ownerDisplayName: string | null;
  itemCount: number;
  /** Total bytes of file items (exposed only to managers). */
  totalBytes?: number;
}

/** Item metadata (no content) used for navigation and lists. */
export interface ShareItemSummary {
  id: string;
  type: ShareItemType;
  title: string;
  language: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  file: FileMeta | null;
}

/** Item with content (code/text) for the selected item panel. */
export interface ShareItemDetail extends ShareItemSummary {
  content: string | null;
}

/**
 * Server-evaluated access state for a share.
 * `ok` means the caller may read content (subject to per-action permissions).
 */
export type ShareAccessState = "ok" | "password_required" | "expired" | "revoked" | "not_found";

export interface ShareAccessInfo {
  state: ShareAccessState;
  share: PublicShare | null;
  /** True when the caller can manage (edit/revoke/delete) this share. */
  canManage: boolean;
  canEdit: boolean;
}

/**
 * Share projection returned before a password/expiry/revocation gate is passed.
 * Contains only what the gate screen needs: no item data, counts or policy flags.
 */
export interface GateShare {
  shareId: string;
  title: string;
  description: string | null;
  visibility: ShareVisibility;
  hasPassword: boolean;
  expiresAt: string | null;
  createdAt: string;
  ownerDisplayName: string | null;
}

/** Response body of `GET /api/shares/[shareId]` and `.../access`. */
export interface ShareViewerPayload {
  state: ShareAccessState;
  /** Full metadata when readable, the gate projection otherwise. */
  share: PublicShare | GateShare | null;
  items: ShareItemSummary[];
  canManage: boolean;
  canEdit: boolean;
  canDownload: boolean;
}

/**
 * Transport decision for a file upload.
 * - `proxy`: send the bytes to our own API (small files, local storage driver)
 * - `direct`: upload to the signed storage URL, then confirm the reservation
 */
export type UploadReservation =
  | { mode: "proxy"; reason: string }
  | {
      mode: "direct";
      reservationId: string;
      /** Object path inside the private bucket. */
      path: string;
      token: string;
      signedUrl: string;
      bucket: string;
      expiresAt: string;
      maxBytes: number;
    };

/** CSV preview table, already parsed and capped by the server. */
export interface CsvPreview {
  columns: string[];
  rows: string[][];
  rowCount: number;
  truncatedRows: boolean;
  truncatedColumns: boolean;
  parseErrors: number;
}

/**
 * Server-prepared file preview. Bytes are never inlined here: the viewer points
 * media at the authorized content route.
 */
export type PreviewPayload =
  | {
      kind: "text";
      text: string;
      truncated: boolean;
      language: string | null;
      format: "text" | "markdown" | "csv";
    }
  | { kind: "markdown"; html: string; truncated: boolean }
  | { kind: "csv"; table: CsvPreview; truncated: boolean }
  | {
      kind: "image" | "pdf" | "archive" | "audio" | "video";
      sizeBytes: number;
      mimeType: string | null;
    }
  | { kind: "unsupported"; reason: string; mimeType: string | null; sizeBytes: number };

/** Who is making a request, as determined by the server. */
export type Actor =
  { kind: "user"; userId: string } | { kind: "guest"; tokenHash: string } | { kind: "anonymous" };

export interface ActorContext {
  actor: Actor;
  /** Best-effort client fingerprint for rate limiting (hashed server-side). */
  rateLimitKey: string;
}

export const EXPIRY_OPTIONS: ReadonlyArray<{ value: ExpiryOption; label: string }> = [
  { value: "1h", label: "1 hour" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "never", label: "Never" },
];

export const CODE_LANGUAGES = [
  "plaintext",
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "python",
  "java",
  "c",
  "cpp",
  "csharp",
  "go",
  "rust",
  "php",
  "html",
  "css",
  "json",
  "sql",
  "bash",
  "yaml",
  "markdown",
] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number];
