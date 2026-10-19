import type {
  FileMeta,
  PublicShare,
  ShareItemDetail,
  ShareItemSummary,
  ShareItemType,
  ShareVisibility,
} from "@/types";

/**
 * Database row shapes and mappers.
 *
 * Rows are internal: they contain password hashes and capability hashes and
 * must never be returned to clients. `toPublicShare` / `toItemSummary` are the
 * only sanctioned ways to expose data outside the server.
 */

export interface ShareRow {
  id: string;
  share_id: string;
  owner_id: string | null;
  guest_owner_token_hash: string | null;
  title: string;
  description: string | null;
  visibility: ShareVisibility;
  password_hash: string | null;
  expires_at: Date | null;
  allow_download: boolean;
  allow_edit: boolean;
  created_at: Date;
  updated_at: Date;
  revoked_at: Date | null;
}

export interface ShareItemRow {
  id: string;
  share_uuid: string;
  item_type: ShareItemType;
  title: string;
  content: string | null;
  language: string | null;
  storage_key: string | null;
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  position: number;
  created_at: Date;
  updated_at: Date;
}

export interface ShareWithCounts extends ShareRow {
  item_count: number;
  total_bytes: number;
  owner_display_name: string | null;
}

export interface AccessGrantRow {
  id: string;
  share_uuid: string;
  grant_hash: string;
  expires_at: Date;
  created_at: Date;
  revoked_at: Date | null;
  last_used_at: Date | null;
}

export interface UploadReservationRow {
  id: string;
  share_uuid: string;
  storage_key: string;
  original_filename: string;
  declared_mime: string | null;
  declared_size: number;
  status: "pending" | "completed" | "aborted" | "expired";
  created_by: string | null;
  created_at: Date;
  expires_at: Date;
  completed_at: Date | null;
}

export interface ProfileRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: Date;
}

const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : value;

export function toFileMeta(row: ShareItemRow): FileMeta | null {
  if (row.item_type !== "file") return null;
  return {
    originalFilename: row.original_filename ?? "file",
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes ?? 0),
  };
}

export function toItemSummary(row: ShareItemRow): ShareItemSummary {
  return {
    id: row.id,
    type: row.item_type,
    title: row.title,
    language: row.language,
    position: row.position,
    createdAt: iso(row.created_at) ?? "",
    updatedAt: iso(row.updated_at) ?? "",
    file: toFileMeta(row),
  };
}

export function toItemDetail(row: ShareItemRow): ShareItemDetail {
  return {
    ...toItemSummary(row),
    content: row.item_type === "file" ? null : row.content,
  };
}

/**
 * Public share projection. Requires counts (computed in SQL) so we never leak
 * storage keys or hashes.
 */
export function toPublicShare(
  row: ShareWithCounts,
  options: { includeTotals?: boolean } = {},
): PublicShare {
  return {
    shareId: row.share_id,
    title: row.title,
    description: row.description,
    visibility: row.visibility,
    hasPassword: Boolean(row.password_hash),
    expiresAt: iso(row.expires_at),
    allowDownload: row.allow_download,
    allowEdit: row.allow_edit,
    createdAt: iso(row.created_at) ?? "",
    updatedAt: iso(row.updated_at) ?? "",
    revokedAt: iso(row.revoked_at),
    ownerDisplayName: row.owner_display_name,
    itemCount: Number(row.item_count ?? 0),
    ...(options.includeTotals ? { totalBytes: Number(row.total_bytes ?? 0) } : {}),
  };
}
