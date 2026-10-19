import "server-only";
import { db } from "@/lib/db/client";
import type { ShareItemRow } from "@/lib/db/rows";
import { AppError } from "@/lib/errors";

/** Data-access layer for `share_items`. */

export interface ItemCounts {
  items: number;
  files: number;
  bytes: number;
}

export async function listItems(shareUuid: string): Promise<ShareItemRow[]> {
  return db()<ShareItemRow[]>`
    select * from public.share_items
     where share_uuid = ${shareUuid}
     order by position asc, created_at asc
  `;
}

export async function getItem(itemId: string): Promise<ShareItemRow | null> {
  const rows = await db()<ShareItemRow[]>`
    select * from public.share_items where id = ${itemId} limit 1
  `;
  return rows[0] ?? null;
}

export async function countItems(shareUuid: string): Promise<ItemCounts> {
  const rows = await db()<{ items: number; files: number; bytes: number }[]>`
    select count(*)::int as items,
           count(*) filter (where item_type = 'file')::int as files,
           coalesce(sum(size_bytes), 0)::bigint as bytes
      from public.share_items
     where share_uuid = ${shareUuid}
  `;
  return rows[0] ?? { items: 0, files: 0, bytes: 0 };
}

export interface InsertItemInput {
  shareUuid: string;
  itemType: "code" | "text" | "file";
  title: string;
  content: string | null;
  language: string | null;
  storageKey: string | null;
  originalFilename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
}

/**
 * Insert an item at the end of the collection.
 *
 * Position assignment uses max(position)+1 inside the same statement so
 * concurrent inserts cannot silently duplicate a position; the deferred unique
 * constraint (share_uuid, position) is the final arbiter and retried below.
 */
export async function insertItem(input: InsertItemInput, attempts = 3): Promise<ShareItemRow> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const rows = await db()<ShareItemRow[]>`
        insert into public.share_items (
          share_uuid, item_type, title, content, language, storage_key,
          original_filename, mime_type, size_bytes, position
        ) values (
          ${input.shareUuid}, ${input.itemType}, ${input.title}, ${input.content},
          ${input.language}, ${input.storageKey}, ${input.originalFilename},
          ${input.mimeType}, ${input.sizeBytes},
          coalesce((select max(position) + 1 from public.share_items where share_uuid = ${input.shareUuid}), 0)
        )
        returning *
      `;
      if (!rows[0]) throw new Error("insert returned no row");
      return rows[0];
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string }).code;
      // 23505 unique violation (position race) / 23503 FK violation
      if (code !== "23505") throw error;
    }
  }
  throw new AppError(
    "conflict",
    "Could not assign a stable position to the new item. Please retry.",
    {
      status: 409,
      cause: lastError,
    },
  );
}

export interface UpdateItemPatch {
  title?: string;
  content?: string;
  language?: string;
}

const UPDATE_COLUMNS = ["title", "content", "language"] as const;

export async function updateItem(
  itemId: string,
  patch: UpdateItemPatch,
): Promise<ShareItemRow | null> {
  const sql = db();
  const entries = Object.entries(patch).filter(
    ([key, value]) =>
      value !== undefined && UPDATE_COLUMNS.includes(key as (typeof UPDATE_COLUMNS)[number]),
  );
  if (entries.length === 0) return getItem(itemId);
  const patchObject = Object.fromEntries(entries) as Record<string, unknown>;
  const rows = await sql<ShareItemRow[]>`
    update public.share_items
       set ${sql(patchObject, ...entries.map(([key]) => key))}
     where id = ${itemId}
    returning *
  `;
  return rows[0] ?? null;
}

export async function deleteItem(itemId: string): Promise<ShareItemRow | null> {
  const rows = await db()<ShareItemRow[]>`
    delete from public.share_items where id = ${itemId} returning *
  `;
  return rows[0] ?? null;
}

/**
 * Persist a new ordering. Runs in a transaction; the deferred unique
 * constraint on (share_uuid, position) allows the single-statement rewrite.
 * Returns false when the provided ids do not exactly match the stored items.
 */
export async function reorderItems(shareUuid: string, orderedIds: string[]): Promise<boolean> {
  return db().begin(async (tx) => {
    const existing = await tx<{ id: string }[]>`
      select id from public.share_items where share_uuid = ${shareUuid}
    `;
    const existingIds = new Set(existing.map((row) => row.id));
    if (existingIds.size !== orderedIds.length) return false;
    for (const id of orderedIds) {
      if (!existingIds.has(id)) return false;
    }

    await tx`
      update public.share_items as si
         set position = v.pos
        from (
          select t.id, (t.ordinality - 1)::int as pos
            from unnest(${tx.array(orderedIds)}::uuid[]) with ordinality as t(id, ordinality)
        ) as v
       where si.id = v.id and si.share_uuid = ${shareUuid}
    `;
    return true;
  });
}
