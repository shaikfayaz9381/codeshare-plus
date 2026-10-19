import "server-only";
import { randomUUID } from "node:crypto";
import { limits, storageBucket } from "@/lib/config/env";
import { AppError, conflict, notFound, payloadTooLarge, quotaExceeded } from "@/lib/errors";
import {
  buildItemStorageKey,
  buildReservationStorageKey,
  sanitizeFilename,
} from "@/lib/security/filenames";
import { detectFile } from "@/lib/uploads/file-types";
import { getStorage } from "@/lib/storage";
import { insertItem } from "@/lib/db/repositories/items";
import {
  abortReservation,
  completeReservation,
  getReservation,
  insertReservation,
} from "@/lib/db/repositories/reservations";
import { consumeQuota, hasQuota } from "@/lib/rate-limit";
import { assertItemCapacity } from "@/lib/services/items";
import { toItemDetail } from "@/lib/db/rows";
import type { ExistingShare } from "@/lib/services/shares";
import type { AccessContext } from "@/lib/services/context";
import type { ReserveUploadInput } from "@/lib/validation/schemas";
import type { ShareItemDetail, UploadReservation } from "@/types";

/**
 * Application layer for file uploads.
 *
 * Two transports share one validation pipeline:
 *  - `proxy`  : the browser POSTs bytes to our server (progress via XHR), used
 *               for files up to MAX_PROXIED_UPLOAD_MB and always in local dev.
 *  - `direct` : the server issues a short-lived signed storage upload URL after
 *               reserving the object; the browser uploads straight to private
 *               storage, then calls complete. Used for larger files.
 *
 * In both cases the server generates the object key, verifies real size and
 * sniffs magic bytes before anything becomes visible in a share.
 */

const SNIFF_BYTES = 4100;
const RESERVATION_TTL_SECONDS = 60 * 60;

async function enforceGuestByteQuota(
  ctx: AccessContext,
  rateLimitKey: string,
  bytes: number,
): Promise<void> {
  if (ctx.actor.kind === "user") return;
  const l = limits();
  await consumeQuota(
    `guest-bytes:${rateLimitKey}`,
    bytes,
    l.rateLimitGuestBytesPerDay,
    24 * 60 * 60,
    "Daily upload volume for anonymous shares exceeded. Sign in for higher limits.",
  );
}

export interface UploadedFileInput {
  bytes: Uint8Array;
  filename: string;
  declaredMime?: string | null;
}

/** Proxied upload: validate + store + create the file item. */
export async function storeProxiedUpload(
  share: ExistingShare,
  ctx: AccessContext,
  rateLimitKey: string,
  file: UploadedFileInput,
): Promise<ShareItemDetail> {
  const l = limits();
  const filename = sanitizeFilename(file.filename);

  if (file.bytes.byteLength === 0) {
    throw new AppError("validation_error", "The uploaded file is empty.", { status: 400 });
  }
  if (file.bytes.byteLength > l.maxProxiedUploadBytes) {
    throw payloadTooLarge(
      `Files above ${Math.floor(l.maxProxiedUploadBytes / (1024 * 1024))} MB use direct-to-storage uploads.`,
    );
  }
  if (file.bytes.byteLength > l.maxUploadBytes) {
    throw payloadTooLarge(
      `Files must be ${Math.floor(l.maxUploadBytes / (1024 * 1024))} MB or smaller.`,
    );
  }

  await assertItemCapacity(share.row.id, { files: 1, bytes: file.bytes.byteLength });

  const detection = await detectFile(file.bytes.subarray(0, SNIFF_BYTES), filename);
  const itemId = randomUUID();
  const storageKey = buildItemStorageKey(share.row.id, itemId, filename);

  await getStorage().put({ key: storageKey, body: file.bytes, contentType: detection.mimeType });

  try {
    const row = await insertItem({
      shareUuid: share.row.id,
      itemType: "file",
      title: filename,
      content: null,
      language: null,
      storageKey,
      originalFilename: filename,
      mimeType: detection.mimeType,
      sizeBytes: file.bytes.byteLength,
    });
    await enforceGuestByteQuota(ctx, rateLimitKey, file.bytes.byteLength);
    return toItemDetail(row);
  } catch (error) {
    // Compensating delete keeps storage consistent with the database.
    await getStorage()
      .delete(storageKey)
      .catch(() => {});
    throw error;
  }
}

export type ReservationResponse = UploadReservation;

/** Reserve an object and issue a signed upload URL (direct transport). */
export async function reserveDirectUpload(
  share: ExistingShare,
  ctx: AccessContext,
  rateLimitKey: string,
  input: ReserveUploadInput,
): Promise<ReservationResponse> {
  const l = limits();
  const filename = sanitizeFilename(input.filename);

  if (input.size > l.maxUploadBytes) {
    throw payloadTooLarge(
      `Files must be ${Math.floor(l.maxUploadBytes / (1024 * 1024))} MB or smaller.`,
    );
  }
  if (input.size <= l.maxProxiedUploadBytes) {
    return { mode: "proxy", reason: "small_file" };
  }

  await assertItemCapacity(share.row.id, { files: 1, bytes: input.size });

  if (ctx.actor.kind !== "user") {
    const available = await hasQuota(
      `guest-bytes:${rateLimitKey}`,
      input.size,
      l.rateLimitGuestBytesPerDay,
    );
    if (!available) {
      throw quotaExceeded(
        "Daily upload volume for anonymous shares exceeded. Sign in for higher limits.",
      );
    }
  }

  const reservationId = randomUUID();
  const storageKey = buildReservationStorageKey(share.row.id, reservationId, filename);
  const signed = await getStorage().createSignedUpload(storageKey);
  if (!signed) {
    // Local storage driver: no direct transport available.
    return { mode: "proxy", reason: "driver_without_signed_uploads" };
  }

  const reservation = await insertReservation({
    id: reservationId,
    shareUuid: share.row.id,
    storageKey,
    originalFilename: filename,
    declaredMime: input.mimeType ?? null,
    declaredSize: input.size,
    createdBy: ctx.actor.kind === "user" ? ctx.actor.userId : null,
    ttlSeconds: RESERVATION_TTL_SECONDS,
  });

  return {
    mode: "direct",
    reservationId,
    path: signed.path,
    token: signed.token,
    signedUrl: signed.signedUrl,
    // The bucket name is not a secret and the browser needs it for the
    // signed upload call; the object stays private.
    bucket: storageBucket(),
    expiresAt: reservation.expires_at.toISOString(),
    maxBytes: l.maxUploadBytes,
  };
}

/** Verify a completed direct upload and turn it into a file item. */
export async function completeDirectUpload(
  share: ExistingShare,
  ctx: AccessContext,
  rateLimitKey: string,
  reservationId: string,
): Promise<ShareItemDetail> {
  const l = limits();
  const reservation = await getReservation(reservationId);
  if (!reservation || reservation.share_uuid !== share.row.id) {
    throw notFound("Upload reservation not found.");
  }
  if (reservation.status !== "pending") {
    throw conflict("This upload reservation is no longer pending.");
  }
  if (reservation.expires_at.getTime() <= Date.now()) {
    await getStorage()
      .delete(reservation.storage_key)
      .catch(() => {});
    await abortReservation(reservationId).catch(() => {});
    throw new AppError("expired", "The upload reservation expired. Please upload the file again.");
  }

  const storage = getStorage();
  const info = await storage.head(reservation.storage_key);
  if (!info || info.size <= 0) {
    throw conflict("The uploaded object was not found in storage. Please retry the upload.");
  }
  if (info.size > reservation.declared_size) {
    await storage.delete(reservation.storage_key).catch(() => {});
    await abortReservation(reservationId).catch(() => {});
    throw payloadTooLarge("The uploaded file is larger than declared. Upload rejected.");
  }
  if (info.size > l.maxUploadBytes) {
    await storage.delete(reservation.storage_key).catch(() => {});
    await abortReservation(reservationId).catch(() => {});
    throw payloadTooLarge(
      `Files must be ${Math.floor(l.maxUploadBytes / (1024 * 1024))} MB or smaller.`,
    );
  }

  await assertItemCapacity(share.row.id, { files: 1, bytes: info.size });

  const head =
    (await storage.readRange(reservation.storage_key, 0, SNIFF_BYTES)) ?? new Uint8Array(0);
  const detection =
    head.byteLength > 0
      ? await detectFile(head, reservation.original_filename)
      : {
          mimeType: "application/octet-stream",
          classification: "unknown" as const,
          sniffed: false,
          binary: true,
        };

  try {
    const row = await insertItem({
      shareUuid: share.row.id,
      itemType: "file",
      title: reservation.original_filename,
      content: null,
      language: null,
      storageKey: reservation.storage_key,
      originalFilename: reservation.original_filename,
      mimeType: detection.mimeType,
      sizeBytes: info.size,
    });
    await completeReservation(reservationId);
    await enforceGuestByteQuota(ctx, rateLimitKey, info.size);
    return toItemDetail(row);
  } catch (error) {
    await storage.delete(reservation.storage_key).catch(() => {});
    await abortReservation(reservationId).catch(() => {});
    throw error;
  }
}

export async function abortDirectUpload(
  share: ExistingShare,
  reservationId: string,
): Promise<void> {
  const reservation = await getReservation(reservationId);
  if (!reservation || reservation.share_uuid !== share.row.id) {
    throw notFound("Upload reservation not found.");
  }
  const aborted = await abortReservation(reservationId);
  if (aborted) {
    await getStorage()
      .delete(reservation.storage_key)
      .catch(() => {});
  }
}
