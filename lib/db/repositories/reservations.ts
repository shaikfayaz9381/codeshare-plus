import "server-only";
import { db } from "@/lib/db/client";
import type { UploadReservationRow } from "@/lib/db/rows";

/**
 * Server-only upload reservations for direct-to-storage uploads.
 * A reservation is created before the client uploads, verified afterwards, and
 * cleaned up (object + row) when abandoned.
 */

export interface InsertReservationInput {
  id: string;
  shareUuid: string;
  storageKey: string;
  originalFilename: string;
  declaredMime: string | null;
  declaredSize: number;
  createdBy: string | null;
  ttlSeconds: number;
}

export async function insertReservation(
  input: InsertReservationInput,
): Promise<UploadReservationRow> {
  const rows = await db()<UploadReservationRow[]>`
    insert into public.upload_reservations (
      id, share_uuid, storage_key, original_filename, declared_mime, declared_size, created_by, expires_at
    ) values (
      ${input.id}, ${input.shareUuid}, ${input.storageKey}, ${input.originalFilename}, ${input.declaredMime},
      ${input.declaredSize}, ${input.createdBy}, now() + make_interval(secs => ${input.ttlSeconds})
    )
    returning *
  `;
  const row = rows[0];
  if (!row) throw new Error("reservation insert returned no row");
  return row;
}

export async function getReservation(id: string): Promise<UploadReservationRow | null> {
  const rows = await db()<UploadReservationRow[]>`
    select * from public.upload_reservations where id = ${id} limit 1
  `;
  return rows[0] ?? null;
}

/** Mark a reservation completed; only succeeds from the pending state. */
export async function completeReservation(id: string): Promise<UploadReservationRow | null> {
  const rows = await db()<UploadReservationRow[]>`
    update public.upload_reservations
       set status = 'completed', completed_at = now()
     where id = ${id} and status = 'pending'
    returning *
  `;
  return rows[0] ?? null;
}

export async function abortReservation(id: string): Promise<UploadReservationRow | null> {
  const rows = await db()<UploadReservationRow[]>`
    update public.upload_reservations
       set status = 'aborted'
     where id = ${id} and status = 'pending'
    returning *
  `;
  return rows[0] ?? null;
}

/**
 * Atomically claim expired pending reservations for cleanup so concurrent
 * cleanup invocations cannot delete the same object twice.
 */
export async function claimExpiredReservations(limit = 50): Promise<UploadReservationRow[]> {
  return db()<UploadReservationRow[]>`
    update public.upload_reservations
       set status = 'expired'
     where id in (
       select id from public.upload_reservations
        where status = 'pending' and expires_at < now()
        order by expires_at asc
        limit ${limit}
        for update skip locked
     )
    returning *
  `;
}

export async function deleteReservation(id: string): Promise<void> {
  await db()`delete from public.upload_reservations where id = ${id}`;
}

/** Delete rows that have been in a terminal state for a while (after object cleanup). */
export async function deleteStaleReservations(olderThanHours = 48): Promise<number> {
  const rows = await db()<{ id: string }[]>`
    delete from public.upload_reservations
     where status in ('completed', 'aborted', 'expired')
       and coalesce(completed_at, created_at) < now() - make_interval(hours => ${olderThanHours})
    returning id
  `;
  return rows.length;
}
