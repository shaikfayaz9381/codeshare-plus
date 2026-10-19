"use client";

import * as React from "react";
import {
  BanIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  LinkIcon,
  Loader2Icon,
  LockIcon,
  Trash2Icon,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ShareQrDialog } from "@/components/builder/share-qr-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { describeRemaining, formatBytes, formatDateTime } from "@/lib/format";
import type { PublicShare } from "@/types";

/**
 * Link management: copy the share URL, see its protection state, revoke it, or
 * delete the collection.
 *
 * Revocation is permanent in the API (`revoked_at` is never cleared), so the
 * copy and the disabled controls say exactly that instead of promising that the
 * link can be restored later.
 */

export interface ShareLinkPanelProps {
  share: PublicShare;
  url: string;
  itemCount: number;
  totalBytes: number;
  busy: boolean;
  onRevoke: () => Promise<void>;
  onDelete: () => Promise<void>;
}

export function ShareLinkPanel({
  share,
  url,
  itemCount,
  totalBytes,
  busy,
  onRevoke,
  onDelete,
}: ShareLinkPanelProps) {
  const [copied, setCopied] = React.useState(false);
  const [copyFailed, setCopyFailed] = React.useState(false);
  const revoked = share.revokedAt !== null;

  async function copy() {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LinkIcon className="size-4" aria-hidden="true" />
          Share link
        </CardTitle>
        <CardDescription>
          {revoked
            ? "This link no longer works for anyone."
            : `Anyone with this URL can read the collection${
                share.hasPassword ? " after entering the password" : ""
              }.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            readOnly
            value={url}
            aria-label="Share URL"
            className="min-w-[240px] flex-1 font-mono text-xs"
          />
          <Button type="button" variant="secondary" onClick={copy} disabled={revoked}>
            {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button asChild variant="ghost" disabled={revoked}>
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLinkIcon aria-hidden="true" />
              Open
            </a>
          </Button>
          <ShareQrDialog url={url} disabled={revoked} />
        </div>
        {copyFailed ? (
          <p className="text-sm text-destructive">
            The browser blocked clipboard access. Select the URL above and copy it manually.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{share.visibility === "public" ? "Public" : "Unlisted"}</Badge>
          <Badge variant={share.hasPassword ? "default" : "outline"}>
            {share.hasPassword ? (
              <>
                <LockIcon className="size-3" aria-hidden="true" />
                Password
              </>
            ) : (
              "No password"
            )}
          </Badge>
          <Badge variant="outline">{describeRemaining(share.expiresAt)}</Badge>
          <Badge variant="outline">
            {itemCount} {itemCount === 1 ? "item" : "items"}
          </Badge>
          {totalBytes > 0 ? <Badge variant="outline">{formatBytes(totalBytes)}</Badge> : null}
          {share.allowDownload ? null : <Badge variant="outline">Downloads off</Badge>}
          {revoked ? <Badge variant="destructive">Revoked</Badge> : null}
        </div>

        <Separator />

        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Expires</dt>
            <dd>{share.expiresAt ? formatDateTime(share.expiresAt) : "Never"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Created</dt>
            <dd>{formatDateTime(share.createdAt)}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" disabled={busy || revoked}>
                {busy ? (
                  <Loader2Icon className="animate-spin" aria-hidden="true" />
                ) : (
                  <BanIcon aria-hidden="true" />
                )}
                Revoke link
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Revoke this link permanently?</AlertDialogTitle>
                <AlertDialogDescription>
                  The URL stops working immediately for everyone and every password unlock is
                  discarded. Revocation cannot be undone — the stored files stay here, but this
                  collection can only be deleted afterwards.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it active</AlertDialogCancel>
                <AlertDialogAction onClick={() => void onRevoke()}>
                  Revoke permanently
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost" className="text-destructive" disabled={busy}>
                <Trash2Icon aria-hidden="true" />
                Delete collection
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this collection?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes {itemCount} {itemCount === 1 ? "item" : "items"} and every stored
                  file from storage. It cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-destructive/90"
                  onClick={() => void onDelete()}
                >
                  Delete permanently
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {revoked ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            Revoked {share.revokedAt ? formatDateTime(share.revokedAt) : ""}. Recipients now get the
            revoked screen, and the API rejects reads, previews and downloads. Delete the collection
            to remove the stored files.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
