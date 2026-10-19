import "server-only";
import { computeExpiresAt, DEFAULT_EXPIRY, isExpired } from "@/lib/security/expiry";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/security/passwords";
import { sha256Hex, safeEqualHex } from "@/lib/security/digest";
import { newShareId } from "@/lib/security/ids";
import {
  AppError,
  conflict,
  expired,
  forbidden,
  notFound,
  passwordRequired,
  revoked as revokedError,
  unauthorized,
} from "@/lib/errors";
import {
  canEditShare,
  canManageShare,
  evaluateAccess,
  type ShareAccessState,
} from "@/lib/permissions/access";
import {
  deleteShare,
  findPurgeableShareUuids,
  getShareByPublicId,
  insertShare,
  listShares,
  recordShareView,
  revokeShare,
  updateShare,
  type InsertShareInput,
  type ListSharesFilter,
  type PagedShares,
} from "@/lib/db/repositories/shares";
import { toPublicShare, type ShareRow, type ShareWithCounts } from "@/lib/db/rows";
import {
  getGrantById,
  insertGrant,
  revokeGrantsForShare,
  touchGrant,
} from "@/lib/db/repositories/grants";
import { getStorage } from "@/lib/storage";
import { createGrantSecrets, createGuestToken, type AccessContext } from "@/lib/services/context";
import { enforceLimit, limitSpecs } from "@/lib/rate-limit";
import type { CreateShareInput, UpdateShareInput } from "@/lib/validation/schemas";
import type { ExpiryOption, PublicShare } from "@/types";

/** Application layer: share lifecycle, access evaluation and authorization. */

export interface ResolvedShare {
  access: ShareAccessState;
  canManage: boolean;
  canEdit: boolean;
  /** True when the caller may fetch file bytes as an attachment / export a ZIP. */
  canDownload: boolean;
  row: ShareWithCounts | null;
  publicShare: PublicShare | null;
}

/** A resolved share that exists (access may still be password_required etc.). */
export type ExistingShare = ResolvedShare & { row: ShareWithCounts; publicShare: PublicShare };

async function hasValidGrant(
  shareUuid: string,
  entry: { grantId: string; secret: string } | undefined,
): Promise<boolean> {
  if (!entry) return false;
  const grant = await getGrantById(entry.grantId);
  if (!grant) return false;
  if (grant.share_uuid !== shareUuid) return false;
  if (grant.revoked_at !== null) return false;
  if (grant.expires_at.getTime() <= Date.now()) return false;
  if (!safeEqualHex(grant.grant_hash, sha256Hex(entry.secret))) return false;

  const lastUsed = grant.last_used_at?.getTime() ?? 0;
  if (Date.now() - lastUsed > 5 * 60 * 1000) {
    await touchGrant(grant.id).catch(() => {});
  }
  return true;
}

function toResolved(
  row: ShareWithCounts,
  access: ShareAccessState,
  ctx: AccessContext,
): ExistingShare {
  const manageable = canManageShare(
    { ownerId: row.owner_id, guestOwnerTokenHash: row.guest_owner_token_hash },
    ctx.actor,
  );
  return {
    access,
    row,
    canManage: manageable,
    canEdit: canEditShare(
      {
        ownerId: row.owner_id,
        guestOwnerTokenHash: row.guest_owner_token_hash,
        allowEdit: row.allow_edit,
      },
      ctx.actor,
    ),
    canDownload: access === "ok" && row.allow_download,
    publicShare: toPublicShare(row, { includeTotals: manageable }),
  };
}

/**
 * Resolve a share by public identifier and evaluate the caller's access.
 * Never throws for missing/expired/revoked shares: pages render dedicated
 * states and APIs translate states explicitly.
 */
export async function resolveShare(
  shareId: string,
  ctx: AccessContext,
  options: { recordView?: boolean } = {},
): Promise<ResolvedShare> {
  const row = await getShareByPublicId(shareId);
  if (!row) {
    return {
      access: "not_found",
      canManage: false,
      canEdit: false,
      canDownload: false,
      row: null,
      publicShare: null,
    };
  }

  const grant = ctx.grants.get(shareId);
  const isManager = canManageShare(
    { ownerId: row.owner_id, guestOwnerTokenHash: row.guest_owner_token_hash },
    ctx.actor,
  );
  const hasGrant = row.password_hash ? await hasValidGrant(row.id, grant) : false;
  const access = evaluateAccess(
    {
      ownerId: row.owner_id,
      guestOwnerTokenHash: row.guest_owner_token_hash,
      hasPassword: Boolean(row.password_hash),
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      allowDownload: row.allow_download,
      allowEdit: row.allow_edit,
    },
    { hasPasswordGrant: hasGrant, isManager },
  );

  if (options.recordView && access === "ok") {
    await recordShareView(row.id).catch(() => {});
  }

  return toResolved(row, access, ctx);
}

/** Map a non-ok access state to the matching AppError. */
export function accessStateError(state: Exclude<ShareAccessState, "ok">): AppError {
  switch (state) {
    case "not_found":
      return notFound("This share does not exist or is no longer available.");
    case "expired":
      return expired();
    case "revoked":
      return revokedError();
    case "password_required":
      return passwordRequired();
  }
}

/** Resolve a share that must exist and be readable; otherwise throw. */
export async function requireReadableShare(
  shareId: string,
  ctx: AccessContext,
  options: { recordView?: boolean } = {},
): Promise<ExistingShare> {
  const resolved = await resolveShare(shareId, ctx, options);
  if (resolved.access === "not_found" || !resolved.row || !resolved.publicShare) {
    throw accessStateError("not_found");
  }
  if (resolved.access !== "ok") {
    throw accessStateError(resolved.access);
  }
  return resolved as ExistingShare;
}

/** Resolve a share that must exist (any access state); otherwise throw. */
export async function requireShare(shareId: string, ctx: AccessContext): Promise<ExistingShare> {
  const resolved = await resolveShare(shareId, ctx);
  if (resolved.access === "not_found" || !resolved.row || !resolved.publicShare) {
    throw accessStateError("not_found");
  }
  return resolved as ExistingShare;
}

/** Resolve a share the caller must be able to manage, else 404 (no existence leak). */
export async function authorizeManageShare(
  shareId: string,
  ctx: AccessContext,
): Promise<ExistingShare> {
  const resolved = await resolveShare(shareId, ctx);
  if (!resolved.row || !resolved.publicShare || !resolved.canManage) {
    throw notFound("Share not found, or you do not have permission to manage it.");
  }
  return resolved as ExistingShare;
}

export interface CreatedShare {
  resolved: ExistingShare;
  /** Present only when a brand-new guest capability was minted for this browser. */
  guestToken: string | null;
}

export async function createShare(
  input: CreateShareInput,
  ctx: AccessContext,
  rateLimitKey: string,
): Promise<CreatedShare> {
  const specs = limitSpecs();
  const actor = ctx.actor;
  await enforceLimit(
    `${actor.kind === "user" ? "create-user" : "create-guest"}:${rateLimitKey}`,
    actor.kind === "user" ? specs.createShareUser : specs.createShareGuest,
  );

  let passwordHash: string | null = null;
  if (input.password) {
    const strength = validatePasswordStrength(input.password);
    if (!strength.ok) {
      throw new AppError("validation_error", strength.message ?? "Invalid password.", {
        status: 400,
      });
    }
    passwordHash = await hashPassword(input.password);
  }

  const expiresAt = computeExpiresAt((input.expiresIn ?? DEFAULT_EXPIRY) as ExpiryOption);

  let guestToken: string | null = null;
  let guestHash: string | null = null;
  if (actor.kind !== "user") {
    if (ctx.guestTokenHash) {
      guestHash = ctx.guestTokenHash;
    } else {
      const created = createGuestToken();
      guestToken = created.token;
      guestHash = created.hash;
    }
  }

  const row = await insertShareWithOptionalCustomId(input, {
    title: input.title,
    description: input.description ?? null,
    visibility: input.visibility ?? "unlisted",
    passwordHash,
    expiresAt,
    allowDownload: input.allowDownload ?? true,
    allowEdit: input.allowEdit ?? false,
    ownerId: actor.kind === "user" ? actor.userId : null,
    guestOwnerTokenHash: guestHash,
  });

  return { resolved: toResolved(row as ShareWithCounts, "ok", ctx), guestToken };
}

/**
 * Insert a share, honouring a caller-chosen link when one was supplied.
 * A taken custom link is mapped to a 409 conflict instead of a retry loop.
 */
async function insertShareWithOptionalCustomId(
  input: CreateShareInput,
  values: InsertShareInput,
): Promise<ShareRow> {
  const customShareId = input.customShareId;
  try {
    return await insertShare(
      values,
      customShareId ? () => customShareId : newShareId,
      customShareId ? 1 : 4,
    );
  } catch (error) {
    if (customShareId && (error as { code?: string }).code === "23505") {
      throw conflict(`The link "${customShareId}" is already taken. Try another one.`);
    }
    throw error;
  }
}

export async function updateShareForManager(
  resolved: ExistingShare,
  input: UpdateShareInput,
): Promise<{ publicShare: PublicShare; passwordChanged: boolean }> {
  const row = resolved.row;
  const patch: Parameters<typeof updateShare>[1] = {};
  let passwordChanged = false;

  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description ?? null;
  if (input.visibility !== undefined) patch.visibility = input.visibility;
  if (input.allowDownload !== undefined) patch.allow_download = input.allowDownload;
  if (input.allowEdit !== undefined) patch.allow_edit = input.allowEdit;
  if (input.expiresIn !== undefined)
    patch.expires_at = computeExpiresAt(input.expiresIn as ExpiryOption);

  if (input.passwordMode === "set" && input.password) {
    const strength = validatePasswordStrength(input.password);
    if (!strength.ok) {
      throw new AppError("validation_error", strength.message ?? "Invalid password.", {
        status: 400,
      });
    }
    patch.password_hash = await hashPassword(input.password);
    passwordChanged = true;
  } else if (input.passwordMode === "clear") {
    patch.password_hash = null;
    passwordChanged = true;
  }

  const updated = await updateShare(row.id, patch);
  if (!updated) throw notFound("Share not found.");

  if (passwordChanged) {
    await revokeGrantsForShare(row.id).catch(() => {});
  }

  const merged: ShareWithCounts = {
    ...row,
    ...updated,
    item_count: row.item_count,
    total_bytes: row.total_bytes,
    owner_display_name: row.owner_display_name,
  };
  return { publicShare: toPublicShare(merged, { includeTotals: true }), passwordChanged };
}

export async function revokeShareForManager(resolved: ExistingShare): Promise<void> {
  await revokeShare(resolved.row.id);
  await revokeGrantsForShare(resolved.row.id).catch(() => {});
}

/** Delete a share: objects first (best effort), then the row (cascades items). */
export async function deleteShareForManager(resolved: ExistingShare): Promise<void> {
  const storage = getStorage();
  try {
    await storage.deletePrefix(`shares/${resolved.row.id}/`);
  } catch (error) {
    console.error(
      `[codeshare] storage cleanup failed for share ${resolved.row.id}:`,
      error instanceof Error ? error.message : error,
    );
  }
  await deleteShare(resolved.row.id);
}

export async function listSharesForActor(
  ctx: AccessContext,
  filter: Omit<ListSharesFilter, "ownerId" | "guestTokenHash">,
): Promise<PagedShares> {
  if (ctx.actor.kind === "user") {
    return listShares({ ...filter, ownerId: ctx.actor.userId });
  }
  if (ctx.actor.kind === "guest" && ctx.guestTokenHash) {
    return listShares({ ...filter, guestTokenHash: ctx.guestTokenHash });
  }
  throw unauthorized("Sign in or restore your guest session to view your collections.");
}

/** A share link is active while it is not revoked and not expired. */
export function isShareLinkActive(
  row: Pick<ShareWithCounts, "revoked_at" | "expires_at">,
): boolean {
  return row.revoked_at === null && !isExpired(row.expires_at);
}

/**
 * Presentation status for a collection row. Evaluated per request; revoked
 * always wins over an expiry date.
 */
export function shareStatus(
  row: Pick<ShareWithCounts, "revoked_at" | "expires_at">,
): "active" | "expired" | "revoked" {
  if (row.revoked_at !== null) return "revoked";
  return isExpired(row.expires_at) ? "expired" : "active";
}

export interface IssuedGrant {
  grantId: string;
  secret: string;
  maxAgeSeconds: number;
}

/**
 * Verify a password and issue a bound, revocable access grant.
 * Rate limiting is enforced by the route (per IP + share).
 */
export async function verifySharePasswordAndIssueGrant(
  resolved: ExistingShare,
  password: string,
): Promise<IssuedGrant> {
  const row = resolved.row;
  if (!row.password_hash) {
    throw new AppError("validation_error", "This share is not password protected.", {
      status: 400,
    });
  }
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) throw forbidden("Incorrect password.");

  const { grantId, secret, hash, maxAgeSeconds } = createGrantSecrets();
  await insertGrant(grantId, row.id, hash, new Date(Date.now() + maxAgeSeconds * 1000));
  return { grantId, secret, maxAgeSeconds };
}

/** Delete shares that were revoked or have been expired for a while. */
export async function purgeExpiredShares(
  olderThanDays: number,
  limit = 25,
): Promise<{ shares: number; objects: number }> {
  const storage = getStorage();
  const uuids = await findPurgeableShareUuids(olderThanDays, limit);
  let objects = 0;
  let shares = 0;
  for (const uuid of uuids) {
    try {
      objects += await storage.deletePrefix(`shares/${uuid}/`);
    } catch {
      // The row is still removed; stray objects can be swept by a later run.
    }
    if (await deleteShare(uuid)) shares += 1;
  }
  return { shares, objects };
}
