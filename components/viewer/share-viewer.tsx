"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowUpRightIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  FileIcon,
  FileTextIcon,
  LinkIcon,
  Loader2Icon,
  LockIcon,
  PencilIcon,
  TimerIcon,
} from "lucide-react";

import { CodeEditor } from "@/components/code-editor";
import { FilePreview } from "@/components/viewer/file-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { api, apiFetch, ApiError } from "@/lib/api/client";
import { describeRemaining, formatBytes, formatDateTime } from "@/lib/format";
import type { PreviewPayload, PublicShare, ShareItemDetail, ShareItemSummary } from "@/types";

/**
 * Public viewer.
 *
 * The page server-renders the share, its item list, and the first item's
 * detail/preview. Selecting another item fetches through the same authorized
 * APIs the server uses, so access rules (password grant, expiry, revocation,
 * download flag) are re-checked on every request.
 */

export interface InitialItem {
  detail: ShareItemDetail;
  preview: PreviewPayload | null;
}

export interface ShareViewerProps {
  share: PublicShare;
  items: ShareItemSummary[];
  canDownload: boolean;
  canManage: boolean;
  shareUrl: string;
  initialItem: InitialItem | null;
}

function ItemTypeIcon({ type }: { type: ShareItemSummary["type"] }) {
  if (type === "file") return <FileIcon className="size-4" aria-hidden="true" />;
  return <FileTextIcon className="size-4" aria-hidden="true" />;
}

function itemSubtitle(item: ShareItemSummary): string {
  if (item.type === "file") {
    return `${item.file?.originalFilename ?? "file"} · ${formatBytes(item.file?.sizeBytes ?? 0)}`;
  }
  if (item.type === "code") return item.language ?? "plaintext";
  return "note";
}

export function ShareViewer({
  share,
  items,
  canDownload,
  canManage,
  shareUrl,
  initialItem,
}: ShareViewerProps) {
  const [activeId, setActiveId] = React.useState<string | null>(initialItem?.detail.id ?? null);
  const [detail, setDetail] = React.useState<ShareItemDetail | null>(initialItem?.detail ?? null);
  const [preview, setPreview] = React.useState<PreviewPayload | null>(initialItem?.preview ?? null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<"link" | "content" | null>(null);

  const contentUrl = detail
    ? `/api/shares/${encodeURIComponent(share.shareId)}/items/${encodeURIComponent(detail.id)}/content`
    : null;

  async function copyText(kind: "link" | "content", value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("The browser blocked clipboard access. Select the text and copy it manually.");
    }
  }

  async function selectItem(itemId: string) {
    if (itemId === activeId || loading) return;
    setActiveId(itemId);
    setLoading(true);
    setError(null);
    setDetail(null);
    setPreview(null);
    try {
      const response = await api.items.get(share.shareId, itemId);
      setDetail(response.item);
      if (response.item.type === "file" && canDownload) {
        const result = await apiFetch<{ preview: PreviewPayload }>(
          `/api/shares/${encodeURIComponent(share.shareId)}/items/${encodeURIComponent(itemId)}/preview`,
        );
        setPreview(result.preview);
      }
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "This item could not be loaded. Try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <header className="mb-6 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">
              {share.title}
            </h1>
            {share.description ? (
              <p className="max-w-3xl text-muted-foreground">{share.description}</p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {share.ownerDisplayName ? `Shared by ${share.ownerDisplayName} · ` : ""}
              Created {formatDateTime(share.createdAt)}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void copyText("link", shareUrl)}
            >
              {copied === "link" ? (
                <CheckIcon aria-hidden="true" />
              ) : (
                <CopyIcon aria-hidden="true" />
              )}
              {copied === "link" ? "Copied" : "Copy link"}
            </Button>
            {canDownload ? (
              <Button asChild size="sm">
                <a href={`/api/shares/${encodeURIComponent(share.shareId)}/download-all`}>
                  <DownloadIcon aria-hidden="true" />
                  Download all
                </a>
              </Button>
            ) : null}
            {canManage ? (
              <Button asChild size="sm" variant="outline">
                <Link href={`/manage/${encodeURIComponent(share.shareId)}`}>
                  <PencilIcon aria-hidden="true" />
                  Manage
                </Link>
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">
            {items.length} {items.length === 1 ? "item" : "items"}
          </Badge>
          {share.hasPassword ? (
            <Badge variant="secondary">
              <LockIcon className="size-3" aria-hidden="true" />
              Password protected
            </Badge>
          ) : null}
          <Badge variant="outline">
            <TimerIcon className="size-3" aria-hidden="true" />
            {describeRemaining(share.expiresAt)}
          </Badge>
          {canDownload ? (
            <Badge variant="outline">Downloads enabled</Badge>
          ) : (
            <Badge variant="outline">Downloads disabled</Badge>
          )}
          {share.visibility === "public" ? <Badge variant="secondary">Public</Badge> : null}
        </div>
      </header>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            This collection is empty.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <nav aria-label="Collection items" className="h-fit rounded-xl border p-2">
            <ul className="space-y-1">
              {items.map((item) => {
                const selected = item.id === activeId;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => void selectItem(item.id)}
                      aria-current={selected ? "true" : undefined}
                      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                        selected
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent/60 focus-visible:bg-accent/60"
                      }`}
                    >
                      <ItemTypeIcon type={item.type} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{item.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {itemSubtitle(item)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <Card className="min-h-[420px]">
            <CardContent className="space-y-4">
              {loading ? (
                <div className="flex min-h-[320px] items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
                  Loading item…
                </div>
              ) : error ? (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
                >
                  {error}
                </p>
              ) : detail ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-medium">{detail.title}</h2>
                      <p className="text-xs text-muted-foreground">
                        {detail.type === "file"
                          ? `${detail.file?.originalFilename ?? "file"} · ${formatBytes(detail.file?.sizeBytes ?? 0)} · ${detail.file?.mimeType ?? "application/octet-stream"}`
                          : `${detail.type === "code" ? (detail.language ?? "plaintext") : "text note"} · updated ${formatDateTime(detail.updatedAt)}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {detail.type !== "file" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => void copyText("content", detail.content ?? "")}
                        >
                          {copied === "content" ? (
                            <CheckIcon aria-hidden="true" />
                          ) : (
                            <CopyIcon aria-hidden="true" />
                          )}
                          {copied === "content" ? "Copied" : "Copy"}
                        </Button>
                      ) : null}
                      {canDownload ? (
                        <Button asChild size="sm" variant="outline">
                          <a href={`${contentUrl}?download=1`} download>
                            <DownloadIcon aria-hidden="true" />
                            Download
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <Separator />

                  {detail.type === "code" ? (
                    <div className="overflow-hidden rounded-lg border">
                      <CodeEditor
                        value={detail.content ?? ""}
                        language={detail.language}
                        readOnly
                        onChange={() => {}}
                        ariaLabel={`Code for ${detail.title}`}
                      />
                    </div>
                  ) : detail.type === "text" ? (
                    <pre className="max-h-[65vh] overflow-auto rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed whitespace-pre-wrap">
                      {detail.content ?? ""}
                    </pre>
                  ) : !canDownload ? (
                    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                      <p className="font-medium text-foreground">Downloads are disabled</p>
                      <p className="mt-1">
                        The owner allows this file to be seen in the collection but not downloaded
                        or previewed.
                      </p>
                    </div>
                  ) : preview ? (
                    <FilePreview preview={preview} item={detail} contentUrl={contentUrl!} />
                  ) : (
                    <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                      No preview is available for this file.
                    </p>
                  )}
                </>
              ) : (
                <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
                  Select an item to view it.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <p className="mt-8 flex items-center justify-center gap-1 text-xs text-muted-foreground">
        <LinkIcon className="size-3" aria-hidden="true" />
        Shared with{" "}
        <Link href="/" className="inline-flex items-center gap-0.5 underline underline-offset-2">
          CodeShare Plus
          <ArrowUpRightIcon className="size-3" aria-hidden="true" />
        </Link>
      </p>
    </div>
  );
}
