import "server-only";
import { limits } from "@/lib/config/env";
import { AppError, notFound, payloadTooLarge, quotaExceeded } from "@/lib/errors";
import {
  countItems,
  deleteItem,
  getItem,
  insertItem,
  listItems,
  reorderItems,
  updateItem,
} from "@/lib/db/repositories/items";
import { toItemDetail, toItemSummary, type ShareItemRow } from "@/lib/db/rows";
import { getStorage } from "@/lib/storage";
import type { ExistingShare } from "@/lib/services/shares";
import type { CreateItemInput, UpdateItemInput } from "@/lib/validation/schemas";
import type { ShareItemDetail, ShareItemSummary } from "@/types";

/** Application layer for share items (code snippets, notes, file references). */

export async function listItemSummaries(shareUuid: string): Promise<ShareItemSummary[]> {
  const rows = await listItems(shareUuid);
  return rows.map(toItemSummary);
}

export async function getItemForShare(itemId: string, shareUuid: string): Promise<ShareItemRow> {
  const row = await getItem(itemId);
  if (!row || row.share_uuid !== shareUuid) {
    throw notFound("Item not found in this share.");
  }
  return row;
}

/** Enforce per-share item/file/byte quotas before adding content. */
export async function assertItemCapacity(
  shareUuid: string,
  incoming: { files?: number; bytes?: number; items?: number } = {},
): Promise<void> {
  const l = limits();
  const counts = await countItems(shareUuid);
  const incomingItems = incoming.items ?? incoming.files ?? 0;
  if (counts.items + incomingItems > l.maxItemsPerShare) {
    throw quotaExceeded(
      `This share already has ${counts.items} items; the limit is ${l.maxItemsPerShare}.`,
    );
  }
  if ((incoming.files ?? 0) > 0 && counts.files + (incoming.files ?? 0) > l.maxFilesPerShare) {
    throw quotaExceeded(
      `This share already has ${counts.files} files; the limit is ${l.maxFilesPerShare}.`,
    );
  }
  const bytes = incoming.bytes ?? 0;
  if (bytes > 0 && counts.bytes + bytes > l.maxShareTotalBytes) {
    throw quotaExceeded(
      `Adding these files would exceed the ${Math.floor(l.maxShareTotalBytes / (1024 * 1024))} MB storage limit for one share.`,
    );
  }
}

function assertContentSize(content: string): void {
  const l = limits();
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > l.maxTextItemBytes) {
    throw payloadTooLarge(
      `Text content is ${Math.ceil(bytes / 1024)} KB; the limit is ${Math.floor(l.maxTextItemBytes / 1024)} KB per item.`,
    );
  }
}

export async function createContentItem(
  share: ExistingShare,
  input: CreateItemInput,
): Promise<ShareItemDetail> {
  await assertItemCapacity(share.row.id, { items: 1 });
  assertContentSize(input.content);

  const row = await insertItem({
    shareUuid: share.row.id,
    itemType: input.type,
    title: input.title,
    content: input.content,
    language: input.type === "code" ? (input.language ?? "plaintext") : null,
    storageKey: null,
    originalFilename: null,
    mimeType: null,
    sizeBytes: null,
  });
  return toItemDetail(row);
}

export async function updateContentItem(
  share: ExistingShare,
  itemId: string,
  patch: UpdateItemInput,
): Promise<ShareItemDetail> {
  const existing = await getItemForShare(itemId, share.row.id);
  if (existing.item_type === "file") {
    if (patch.content !== undefined || patch.language !== undefined) {
      throw new AppError("validation_error", "File items only support renaming.", { status: 400 });
    }
  }
  if (patch.content !== undefined) assertContentSize(patch.content);

  const cleaned: UpdateItemInput = {};
  if (patch.title !== undefined) cleaned.title = patch.title;
  if (patch.content !== undefined && existing.item_type !== "file") cleaned.content = patch.content;
  if (patch.language !== undefined && existing.item_type === "code")
    cleaned.language = patch.language;

  const row = await updateItem(itemId, cleaned);
  if (!row) throw notFound("Item not found.");
  return toItemDetail(row);
}

/** Delete an item and its stored object (files) exactly once. */
export async function deleteItemForShare(share: ExistingShare, itemId: string): Promise<void> {
  const existing = await getItemForShare(itemId, share.row.id);
  const row = await deleteItem(itemId);
  if (!row) return;
  if (existing.item_type === "file" && existing.storage_key) {
    try {
      await getStorage().delete(existing.storage_key);
    } catch (error) {
      // The row is gone; orphaned objects are swept by maintenance jobs.
      console.error(
        "[codeshare] failed to delete stored object:",
        error instanceof Error ? error.message : error,
      );
    }
  }
}

export async function reorderShareItems(share: ExistingShare, itemIds: string[]): Promise<void> {
  const ok = await reorderItems(share.row.id, itemIds);
  if (!ok) {
    throw new AppError("conflict", "The provided ordering does not match the current items.", {
      status: 409,
    });
  }
}

/** All items of a share (internal: includes storage keys). */
export async function listItemRows(shareUuid: string): Promise<ShareItemRow[]> {
  return listItems(shareUuid);
}
