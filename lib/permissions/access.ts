import type { Actor } from "@/types";
import { safeEqualHex, sha256Hex } from "@/lib/security/digest";
import { isExpired } from "@/lib/security/expiry";

/**
 * Pure permission evaluation. No database or network access, fully unit
 * testable, and used exclusively server-side to decide access. UI-only hiding
 * is never an authorization mechanism.
 */

export interface AccessRelevantShare {
  ownerId: string | null;
  guestOwnerTokenHash: string | null;
  hasPassword: boolean;
  expiresAt: Date | string | null;
  revokedAt: Date | string | null;
  allowDownload: boolean;
  allowEdit: boolean;
}

export type ShareAccessState = "ok" | "password_required" | "expired" | "revoked" | "not_found";

/**
 * Evaluate read access for a share.
 * Order matters: revocation wins over expiry, expiry over password prompts.
 *
 * `isManager` short-circuits the password gate for the share's owner (an
 * authenticated user or the holder of the guest capability cookie). The
 * capability is what already authorizes PATCH/revoke/delete via
 * `canManageShare`, so it also unlocks reading — otherwise setting a password
 * would lock the creator out of their own collection.
 */
export function evaluateAccess(
  share: AccessRelevantShare | null,
  options: { hasPasswordGrant: boolean; isManager?: boolean; now?: Date },
): ShareAccessState {
  if (!share) return "not_found";
  const now = options.now ?? new Date();
  if (share.revokedAt) return "revoked";
  if (isExpired(share.expiresAt, now)) return "expired";
  if (share.hasPassword && !options.hasPasswordGrant && !options.isManager) {
    return "password_required";
  }
  return "ok";
}

/** Owners (authenticated) and guest capability holders may manage a share. */
export function canManageShare(
  share: Pick<AccessRelevantShare, "ownerId" | "guestOwnerTokenHash"> | null,
  actor: Actor,
): boolean {
  if (!share) return false;
  if (actor.kind === "user") {
    return share.ownerId !== null && share.ownerId === actor.userId;
  }
  if (actor.kind === "guest") {
    if (!share.guestOwnerTokenHash) return false;
    return safeEqualHex(actor.tokenHash, share.guestOwnerTokenHash);
  }
  return false;
}

/**
 * Whether a caller may edit item content.
 * Owners/managers always may; ordinary link recipients never do, regardless of
 * the `allowEdit` flag (which only marks a share as "collaborative" for the UI
 * and for future explicit collaborator grants — it is not a capability).
 */
export function canEditShare(
  share: Pick<AccessRelevantShare, "ownerId" | "guestOwnerTokenHash" | "allowEdit"> | null,
  actor: Actor,
): boolean {
  if (!share) return false;
  if (canManageShare(share, actor)) return true;
  // allowEdit does not grant permission to anonymous recipients. It exists so a
  // share can be *marked* collaborative; collaborator grants must be explicit
  // (signed-in users added as collaborators) — see README "Permissions".
  return false;
}

/** Download permission (file items and ZIP export). */
export function canDownloadShare(
  share: Pick<AccessRelevantShare, "allowDownload"> | null,
): boolean {
  return Boolean(share?.allowDownload);
}

/** Hash a presented guest capability for comparison with stored hashes. */
export function guestTokenHash(token: string): string {
  return sha256Hex(token);
}

/** Hash a presented access-grant secret. */
export function grantSecretHash(secret: string): string {
  return sha256Hex(secret);
}
