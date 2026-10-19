"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BanIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, ApiError } from "@/lib/api/client";

/**
 * Per-collection actions on the dashboard. Revocation and deletion are
 * destructive and permanent, so both are behind an explicit confirmation.
 * Authorization is enforced by the API; this component only mirrors the result.
 */

export interface ShareRowActionsProps {
  shareId: string;
  title: string;
  url: string;
  revoked: boolean;
}

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function ShareRowActions({ shareId, title, url, revoked }: ShareRowActionsProps) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState<"revoke" | "delete" | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      toast.success("Share link copied.");
    } catch {
      toast.error("The browser blocked clipboard access. Open the share page and copy the URL.");
    }
  }

  async function run(action: "revoke" | "delete") {
    setBusy(true);
    try {
      if (action === "revoke") {
        await api.shares.revoke(shareId);
        toast.success("Link revoked. It can no longer be opened.");
      } else {
        await api.shares.remove(shareId);
        toast.success("Collection deleted.");
      }
      setConfirming(null);
      router.refresh();
    } catch (error) {
      toast.error(
        message(error, action === "revoke" ? "Could not revoke the link." : "Could not delete."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => void copyLink()}>
        {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
        {copied ? "Copied" : "Copy link"}
      </Button>
      <Button asChild variant="outline" size="sm">
        <Link href={`/manage/${encodeURIComponent(shareId)}`}>
          <PencilIcon aria-hidden="true" />
          Manage
        </Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`More actions for ${title}`}
          >
            <MoreHorizontalIcon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/s/${encodeURIComponent(shareId)}`}>
              <ExternalLinkIcon aria-hidden="true" />
              Open share page
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copyLink()}>
            <CopyIcon aria-hidden="true" />
            Copy link
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={revoked}
            onSelect={() => setConfirming("revoke")}
          >
            <BanIcon aria-hidden="true" />
            {revoked ? "Already revoked" : "Revoke link"}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirming("delete")}>
            <Trash2Icon aria-hidden="true" />
            Delete collection
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming === "delete" ? "Delete this collection?" : "Revoke this link?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming === "delete" ? (
                <>
                  <strong>{title}</strong> and every stored file will be deleted permanently. Anyone
                  holding the link will get a 404.
                </>
              ) : (
                <>
                  <strong>{title}</strong> will stop opening immediately. Revocation is permanent —
                  the link, password, and expiry cannot be restored. Delete the collection instead
                  if you want the files gone too.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                if (confirming) void run(confirming);
              }}
            >
              {busy ? "Working…" : confirming === "delete" ? "Delete collection" : "Revoke link"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
