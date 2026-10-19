import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ShareGate } from "@/components/viewer/share-gate";
import { ShareViewer } from "@/components/viewer/share-viewer";
import { appUrl } from "@/lib/config/env";
import { toItemDetail } from "@/lib/db/rows";
import { getPageAccessContext } from "@/lib/services/context";
import { getItemForShare } from "@/lib/services/items";
import { previewFileItem, type PreviewResponse } from "@/lib/services/previews";
import { buildViewerPayload } from "@/lib/services/viewer";
import type { GateShare, PublicShare, ShareItemDetail } from "@/types";

/**
 * Public share page `/s/[shareId]`.
 *
 * Access is evaluated on the server for every request (guest capability,
 * password grant, expiry, revocation, download flag). The first item's detail
 * and preview are prepared server-side, so the initial view needs no extra
 * round trip; later selections go through the authorized item/preview APIs.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/s/[shareId]">): Promise<Metadata> {
  const { shareId } = await params;
  const context = await getPageAccessContext();
  const { payload } = await buildViewerPayload(shareId, context, { includeItems: false });

  if (!payload.share) {
    return { title: "Share not found", robots: { index: false, follow: false } };
  }

  const description =
    payload.share.description ??
    `A collection shared with CodeShare Plus${payload.share.ownerDisplayName ? ` by ${payload.share.ownerDisplayName}` : ""}.`;

  return {
    title: payload.share.title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title: payload.share.title,
      description,
      type: "website",
    },
  };
}

export default async function SharePage({ params }: PageProps<"/s/[shareId]">) {
  const { shareId } = await params;
  const context = await getPageAccessContext();
  const { payload, shareUuid } = await buildViewerPayload(shareId, context, {
    includeItems: true,
    recordView: true,
  });

  if (payload.state === "not_found" || !payload.share) {
    notFound();
  }

  if (payload.state !== "ok") {
    return <ShareGate state={payload.state} share={payload.share as GateShare} />;
  }

  const share = payload.share as PublicShare;

  let initialItem: { detail: ShareItemDetail; preview: PreviewResponse | null } | null = null;
  const first = payload.items[0];
  if (first && shareUuid) {
    try {
      const row = await getItemForShare(first.id, shareUuid);
      const detail = toItemDetail(row);
      let preview: PreviewResponse | null = null;
      if (detail.type === "file" && payload.canDownload) {
        preview = await previewFileItem(row).catch(() => null);
      }
      initialItem = { detail, preview };
    } catch {
      initialItem = null;
    }
  }

  return (
    <ShareViewer
      share={share}
      items={payload.items}
      canDownload={payload.canDownload}
      canManage={payload.canManage}
      shareUrl={`${appUrl()}/s/${share.shareId}`}
      initialItem={initialItem}
    />
  );
}
