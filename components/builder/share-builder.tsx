"use client";

import * as React from "react";
import { AlertTriangleIcon, Loader2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { ItemEditor, type ItemDraft } from "@/components/builder/item-editor";
import { ItemSidebar } from "@/components/builder/item-sidebar";
import { ShareDetailsForm } from "@/components/builder/share-details-form";
import { ShareLinkPanel } from "@/components/builder/share-link-panel";
import { ShareSettingsForm } from "@/components/builder/share-settings-form";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, ApiError } from "@/lib/api/client";
import { formatBytes } from "@/lib/format";
import { uploadShareFile } from "@/lib/uploads/client-upload";
import type { CreateShareInput, UpdateItemInput, UpdateShareInput } from "@/lib/validation/schemas";
import type { PublicShare, ShareItemDetail, ShareItemSummary } from "@/types";

/**
 * The share builder.
 *
 * Two phases in one page:
 *  1. `details` — the collection does not exist yet; a required title (plus the
 *     access rules) is submitted to `POST /api/shares`.
 *  2. `editing` — the share exists, so items can be added, uploaded, reordered
 *     and deleted, settings can be changed, and the link can be revoked.
 *
 * Creating the share only happens after the user submits the details form: this
 * avoids littering the database with empty shares on every page view, and it
 * gives the upload endpoints the share id they need.
 */

interface PendingUpload {
  id: string;
  filename: string;
  percent: number;
}

export interface ShareBuilderProps {
  maxItems: number;
  maxFiles: number;
  maxUploadBytes: number;
  /**
   * Existing-collection mode. `/manage/[shareId]` passes the share and its
   * items, so the details phase is skipped and the editing workspace opens
   * directly (the server has already authorized the caller).
   */
  initialShare?: PublicShare;
  initialItems?: ShareItemSummary[];
  initialItem?: ShareItemDetail | null;
  initialUrl?: string;
}

function draftFromItem(item: ShareItemDetail): ItemDraft {
  return {
    title: item.title,
    content: item.content ?? "",
    language: item.language,
  };
}

function summaryFromDetail(item: ShareItemDetail): ShareItemSummary {
  const { content: _content, ...summary } = item;
  return summary;
}

function affectsLanguage(
  draft: ItemDraft,
  item: ShareItemDetail,
): UpdateItemInput["language"] | undefined {
  if (item.type !== "code") return undefined;
  if (draft.language === null) return "plaintext";
  return draft.language as UpdateItemInput["language"];
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function ShareBuilder({
  maxItems,
  maxFiles,
  maxUploadBytes,
  initialShare,
  initialItems,
  initialItem,
  initialUrl,
}: ShareBuilderProps) {
  const [share, setShare] = React.useState<PublicShare | null>(initialShare ?? null);
  const [url, setUrl] = React.useState<string>(initialUrl ?? "");
  const [items, setItems] = React.useState<ShareItemSummary[]>(initialItems ?? []);
  const [selectedId, setSelectedId] = React.useState<string | null>(initialItem?.id ?? null);
  const [detail, setDetail] = React.useState<ShareItemDetail | null>(initialItem ?? null);
  const [draft, setDraft] = React.useState<ItemDraft | null>(
    initialItem ? draftFromItem(initialItem) : null,
  );
  const [loadingItem, setLoadingItem] = React.useState(false);
  const [savingItem, setSavingItem] = React.useState(false);
  const [busyItemId, setBusyItemId] = React.useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null);
  const [uploads, setUploads] = React.useState<PendingUpload[]>([]);
  const [busyShare, setBusyShare] = React.useState(false);
  const [pageError, setPageError] = React.useState<string | null>(null);

  const uploadSeq = React.useRef(0);
  const loadSeq = React.useRef(0);

  const dirty =
    detail !== null &&
    draft !== null &&
    (draft.title !== detail.title ||
      (detail.type !== "file" && draft.content !== (detail.content ?? "")) ||
      (detail.type === "code" && draft.language !== detail.language));

  // Guard against losing pending edits when the tab is closed.
  React.useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const revoked = share?.revokedAt != null;
  const totalBytes = items.reduce((sum, item) => sum + (item.file?.sizeBytes ?? 0), 0);

  async function loadItem(itemId: string) {
    if (!share) return;
    const token = ++loadSeq.current;
    setLoadingItem(true);
    setPageError(null);
    try {
      const { item } = await api.items.get(share.shareId, itemId);
      if (token !== loadSeq.current) return;
      setDetail(item);
      setDraft(draftFromItem(item));
    } catch (error) {
      if (token !== loadSeq.current) return;
      setPageError(errorMessage(error, "Could not load this item."));
      setDetail(null);
      setDraft(null);
    } finally {
      if (token === loadSeq.current) setLoadingItem(false);
    }
  }

  /** Persist the current draft. Returns false when the save failed. */
  async function saveItem(): Promise<boolean> {
    if (!share || !detail || !draft) return false;
    if (!dirty) return true;

    const patch: UpdateItemInput = {};
    if (draft.title !== detail.title) patch.title = draft.title;
    if (detail.type !== "file" && draft.content !== (detail.content ?? "")) {
      patch.content = draft.content;
    }
    if (detail.type === "code" && draft.language !== detail.language) {
      const language = affectsLanguage(draft, detail);
      if (language) patch.language = language;
    }
    if (Object.keys(patch).length === 0) return true;

    setSavingItem(true);
    setPageError(null);
    try {
      const { item } = await api.items.update(share.shareId, detail.id, patch);
      setDetail(item);
      setDraft(draftFromItem(item));
      setItems((previous) =>
        previous.map((entry) => (entry.id === item.id ? summaryFromDetail(item) : entry)),
      );
      return true;
    } catch (error) {
      setPageError(errorMessage(error, "Could not save the item."));
      return false;
    } finally {
      setSavingItem(false);
    }
  }

  async function handleCreate(input: CreateShareInput) {
    const response = await api.shares.create(input);
    setShare(response.share);
    setUrl(response.url);
    setItems([]);
    setSelectedId(null);
    setDetail(null);
    setDraft(null);
    toast.success("Collection created. Add your first item.");
  }

  async function handleSelect(itemId: string) {
    if (itemId === selectedId || loadingItem) return;
    if (dirty) {
      const saved = await saveItem();
      if (!saved) return;
    }
    setSelectedId(itemId);
    setDetail(null);
    setDraft(null);
    await loadItem(itemId);
  }

  async function handleAddItem(type: "code" | "text") {
    if (!share || revoked) return;
    if (dirty) {
      const saved = await saveItem();
      if (!saved) return;
    }
    const input =
      type === "code"
        ? ({
            type: "code",
            title: "Untitled snippet",
            // The API requires at least one character; a fresh snippet starts as
            // a single empty line and the user replaces it immediately.
            content: "\n",
            language: "plaintext",
          } as const)
        : ({ type: "text", title: "Untitled note", content: "\n" } as const);

    try {
      const { item } = await api.items.create(share.shareId, input);
      setItems((previous) => [...previous, summaryFromDetail(item)]);
      setShare((previous) =>
        previous ? { ...previous, itemCount: previous.itemCount + 1 } : previous,
      );
      setSelectedId(item.id);
      setDetail(item);
      setDraft(draftFromItem(item));
    } catch (error) {
      toast.error(errorMessage(error, "Could not add the item."));
    }
  }

  async function handleMove(itemId: string, direction: -1 | 1) {
    if (!share || revoked) return;
    const index = items.findIndex((entry) => entry.id === itemId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;

    const previous = items;
    const next = items.slice();
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    setItems(next);

    try {
      const response = await api.items.reorder(
        share.shareId,
        next.map((entry) => entry.id),
      );
      setItems(response.items);
    } catch (error) {
      setItems(previous);
      toast.error(errorMessage(error, "Could not save the new order."));
    }
  }

  async function handleConfirmDelete() {
    if (!share || !pendingDeleteId) return;
    const itemId = pendingDeleteId;
    setBusyItemId(itemId);
    try {
      await api.items.remove(share.shareId, itemId);
      const remaining = items.filter((entry) => entry.id !== itemId);
      setItems(remaining);
      setShare((previous) =>
        previous ? { ...previous, itemCount: Math.max(0, previous.itemCount - 1) } : previous,
      );
      if (itemId === selectedId) {
        const nextItem = remaining[0] ?? null;
        setSelectedId(null);
        setDetail(null);
        setDraft(null);
        if (nextItem) await handleSelectAfterDelete(nextItem.id);
      }
      toast.success("Item deleted.");
    } catch (error) {
      toast.error(errorMessage(error, "Could not delete the item."));
    } finally {
      setBusyItemId(null);
      setPendingDeleteId(null);
    }
  }

  /** Load an item directly, bypassing the dirty-draft guard (caller deleted it). */
  async function handleSelectAfterDelete(itemId: string) {
    setSelectedId(itemId);
    await loadItem(itemId);
  }

  async function handleUpload(selectedFiles: File[]) {
    if (!share || revoked || selectedFiles.length === 0) return;
    if (dirty) {
      const saved = await saveItem();
      if (!saved) return;
    }

    const fileCount = items.filter((entry) => entry.type === "file").length;
    const fileSlots = Math.max(0, maxFiles - fileCount);
    const itemSlots = Math.max(0, maxItems - items.length);
    const allowed = Math.min(fileSlots, itemSlots);

    if (allowed === 0) {
      toast.error(
        `This collection already holds ${fileCount} file(s) and ${items.length} item(s) — the limits are ${maxFiles} files and ${maxItems} items.`,
      );
      return;
    }

    const batch = selectedFiles.slice(0, allowed);
    if (selectedFiles.length > batch.length) {
      toast.warning(
        `Only ${batch.length} of ${selectedFiles.length} files were uploaded: the collection accepts ${maxFiles} files and ${maxItems} items.`,
      );
    }

    for (const file of batch) {
      uploadSeq.current += 1;
      const id = `upload-${uploadSeq.current}`;

      if (file.size > maxUploadBytes) {
        toast.error(`${file.name} is larger than the ${formatBytes(maxUploadBytes)} limit.`);
        continue;
      }

      setUploads((previous) => [...previous, { id, filename: file.name, percent: 0 }]);
      try {
        const item = await uploadShareFile(share.shareId, file, {
          onProgress: ({ loaded, total }) => {
            const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
            setUploads((previous) =>
              previous.map((entry) => (entry.id === id ? { ...entry, percent } : entry)),
            );
          },
        });
        setItems((previous) => [...previous, summaryFromDetail(item)]);
        setShare((previous) =>
          previous ? { ...previous, itemCount: previous.itemCount + 1 } : previous,
        );
        toast.success(`${item.file?.originalFilename ?? file.name} uploaded.`);
      } catch (error) {
        toast.error(errorMessage(error, `Could not upload ${file.name}.`));
      } finally {
        setUploads((previous) => previous.filter((entry) => entry.id !== id));
      }
    }
  }

  async function handleSaveSettings(input: UpdateShareInput) {
    if (!share) return;
    const response = await api.shares.update(share.shareId, input);
    setShare(response.share);
    setUrl(response.url);
    toast.success(
      response.passwordChanged
        ? "Settings saved. The password change invalidated existing unlocks."
        : "Settings saved.",
    );
  }

  async function handleRevoke() {
    if (!share) return;
    setBusyShare(true);
    try {
      await api.shares.revoke(share.shareId);
      // Revocation is permanent server-side; mirror the new state locally.
      setShare((previous) =>
        previous ? { ...previous, revokedAt: new Date().toISOString() } : previous,
      );
      toast.success("Link revoked. Nobody can open it anymore.");
    } catch (error) {
      toast.error(errorMessage(error, "Could not revoke the link."));
    } finally {
      setBusyShare(false);
    }
  }

  async function handleDelete() {
    if (!share) return;
    setBusyShare(true);
    try {
      await api.shares.remove(share.shareId);
      setShare(null);
      setItems([]);
      setSelectedId(null);
      setDetail(null);
      setDraft(null);
      setUrl("");
      toast.success("Collection deleted, including its stored files.");
    } catch (error) {
      toast.error(errorMessage(error, "Could not delete the collection."));
    } finally {
      setBusyShare(false);
    }
  }

  if (!share) {
    return <ShareDetailsForm onCreate={handleCreate} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{share.title}</h2>
        <Badge variant="secondary">{share.itemCount} items</Badge>
        {revoked ? <Badge variant="destructive">Revoked</Badge> : null}
      </div>

      {pageError ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="flex-1">{pageError}</p>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-6"
            aria-label="Dismiss error"
            onClick={() => setPageError(null)}
          >
            <XIcon className="size-3.5" />
          </Button>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Items</CardTitle>
            <CardDescription>
              Order here is the order recipients see. Reordering saves immediately.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ItemSidebar
              items={items}
              selectedId={selectedId}
              busyItemId={busyItemId}
              uploads={uploads}
              disabled={revoked}
              maxFiles={maxFiles}
              maxItems={maxItems}
              onSelect={(itemId) => void handleSelect(itemId)}
              onAddCode={() => void handleAddItem("code")}
              onAddText={() => void handleAddItem("text")}
              onUpload={(files) => void handleUpload(files)}
              onMove={(itemId, direction) => void handleMove(itemId, direction)}
              onDelete={setPendingDeleteId}
            />
          </CardContent>
        </Card>

        <Card className="min-h-[420px]">
          <CardContent className="h-full">
            {loadingItem ? (
              <div className="flex h-full min-h-[320px] items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
                Loading item…
              </div>
            ) : detail && draft ? (
              <ItemEditor
                shareId={share.shareId}
                item={detail}
                summary={summaryFromDetail(detail)}
                draft={draft}
                dirty={dirty}
                saving={savingItem}
                canDownload={share.allowDownload && !revoked}
                onDraftChange={setDraft}
                onSave={() => void saveItem()}
                onReload={() => setDraft(draftFromItem(detail))}
              />
            ) : (
              <div className="flex h-full min-h-[320px] items-center justify-center rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                Select an item on the left to edit it, or add a new one.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ShareLinkPanel
          share={share}
          url={url}
          itemCount={items.length}
          totalBytes={totalBytes}
          busy={busyShare}
          onRevoke={handleRevoke}
          onDelete={handleDelete}
        />

        <Card>
          <CardHeader>
            <CardTitle>Collection settings</CardTitle>
            <CardDescription>
              {revoked
                ? "This collection is revoked. Settings no longer affect access."
                : "Changes apply to the live link immediately."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {revoked ? (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                Revocation is permanent, so the link, password and expiry cannot be restored. Delete
                the collection from the panel on the left, or start a new one.
              </p>
            ) : (
              <ShareSettingsForm share={share} onSave={handleSaveSettings} />
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this item?</AlertDialogTitle>
            <AlertDialogDescription>
              The item and, for uploads, its stored file are removed permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void handleConfirmDelete()}
            >
              Delete item
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
