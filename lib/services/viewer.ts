import "server-only";
import { resolveShare, type ResolvedShare } from "@/lib/services/shares";
import { listItemSummaries } from "@/lib/services/items";
import type { AccessContext } from "@/lib/services/context";
import type { GateShare, PublicShare, ShareAccessState, ShareViewerPayload } from "@/types";

/**
 * Share viewer payloads shared by the access and detail endpoints.
 *
 * For non-ok states we return a *gate projection*: only the information needed
 * to render the state (title, description, owner, expiry). Item titles, counts,
 * storage metadata and policy flags are not disclosed before authorization.
 */

/** Re-exported for callers that previously imported the shape from this module. */
export type ViewerPayload = ShareViewerPayload;
export type { GateShare };

function gateProjection(share: PublicShare): GateShare {
  return {
    shareId: share.shareId,
    title: share.title,
    description: share.description,
    visibility: share.visibility,
    hasPassword: share.hasPassword,
    expiresAt: share.expiresAt,
    createdAt: share.createdAt,
    ownerDisplayName: share.ownerDisplayName,
  };
}

export function statusForState(state: ShareAccessState): number {
  switch (state) {
    case "ok":
    case "password_required":
      return 200;
    case "not_found":
      return 404;
    case "revoked":
      return 403;
    case "expired":
      return 410;
  }
}

export async function buildViewerPayload(
  shareId: string,
  ctx: AccessContext,
  options: { includeItems?: boolean; recordView?: boolean } = {},
): Promise<{ payload: ViewerPayload; status: number; shareUuid: string | null }> {
  const resolved: ResolvedShare = await resolveShare(shareId, ctx, {
    recordView: options.recordView,
  });
  const state = resolved.access;
  const shareUuid = resolved.row?.id ?? null;

  if (state === "not_found" || !resolved.publicShare) {
    return {
      payload: {
        state,
        share: null,
        items: [],
        canManage: false,
        canEdit: false,
        canDownload: false,
      },
      status: statusForState(state),
      shareUuid: null,
    };
  }

  if (state !== "ok") {
    return {
      payload: {
        state,
        share: gateProjection(resolved.publicShare),
        items: [],
        canManage: false,
        canEdit: false,
        canDownload: false,
      },
      status: statusForState(state),
      shareUuid,
    };
  }

  const items = options.includeItems === false ? [] : await listItemSummaries(resolved.row!.id);

  return {
    payload: {
      state,
      share: resolved.publicShare,
      items,
      canManage: resolved.canManage,
      canEdit: resolved.canEdit,
      canDownload: resolved.canDownload,
    },
    status: 200,
    shareUuid,
  };
}
