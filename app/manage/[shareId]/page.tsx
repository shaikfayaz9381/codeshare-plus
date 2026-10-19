import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon, ExternalLinkIcon } from "lucide-react";

import { ShareBuilder } from "@/components/builder/share-builder";
import { Button } from "@/components/ui/button";
import { appUrl, limits } from "@/lib/config/env";
import { toItemDetail } from "@/lib/db/rows";
import { getPageAccessContext } from "@/lib/services/context";
import { getItemForShare, listItemSummaries } from "@/lib/services/items";
import { authorizeManageShare } from "@/lib/services/shares";
import type { ShareItemDetail, ShareItemSummary } from "@/types";

/**
 * `/manage/[shareId]` — full management workspace for an existing collection.
 *
 * Authorization happens here on the server (`authorizeManageShare`); knowing the
 * public share id is not enough. The builder then reuses the same APIs as the
 * create flow, which re-check the caller on every mutation.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Manage collection",
  robots: { index: false, follow: false },
};

export default async function ManageSharePage({ params }: PageProps<"/manage/[shareId]">) {
  const { shareId } = await params;
  const context = await getPageAccessContext();

  let resolved;
  try {
    resolved = await authorizeManageShare(shareId, context);
  } catch {
    notFound();
  }

  const summaries: ShareItemSummary[] = await listItemSummaries(resolved.row.id);

  let initialItem: ShareItemDetail | null = null;
  const first = summaries[0];
  if (first) {
    try {
      initialItem = toItemDetail(await getItemForShare(first.id, resolved.row.id));
    } catch {
      initialItem = null;
    }
  }

  const config = limits();
  const shareUrl = `${appUrl()}/s/${resolved.row.share_id}`;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
      <header className="mb-8 space-y-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
          <Link href="/dashboard">
            <ChevronLeftIcon aria-hidden="true" />
            Dashboard
          </Link>
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight">Manage collection</h1>
            <p className="max-w-2xl text-muted-foreground">
              Edit items, change access rules, or revoke and delete this collection.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href={`/s/${encodeURIComponent(resolved.row.share_id)}`}>
              Open share page
              <ExternalLinkIcon aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </header>

      <ShareBuilder
        maxItems={config.maxItemsPerShare}
        maxFiles={config.maxFilesPerShare}
        maxUploadBytes={config.maxUploadBytes}
        initialShare={resolved.publicShare}
        initialItems={summaries}
        initialItem={initialItem}
        initialUrl={shareUrl}
      />
    </div>
  );
}
