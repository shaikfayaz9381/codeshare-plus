"use client";

import * as React from "react";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  FileIcon,
  FileTextIcon,
  Loader2Icon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { formatBytes } from "@/lib/format";
import type { ShareItemSummary } from "@/types";

/**
 * Item list for the builder.
 *
 * Reordering is persisted immediately (optimistic, then reconciled with the
 * server response) because ordering is data, not decoration.
 */

export interface ItemSidebarProps {
  items: ShareItemSummary[];
  selectedId: string | null;
  busyItemId: string | null;
  uploads: Array<{ id: string; filename: string; percent: number }>;
  disabled?: boolean;
  maxFiles: number;
  maxItems: number;
  onSelect: (itemId: string) => void;
  onAddCode: () => void;
  onAddText: () => void;
  onUpload: (files: File[]) => void;
  onMove: (itemId: string, direction: -1 | 1) => void;
  onDelete: (itemId: string) => void;
}

function ItemIcon({ item }: { item: ShareItemSummary }) {
  if (item.type === "file") return <FileIcon className="size-4 shrink-0" aria-hidden="true" />;
  if (item.type === "code") return <FileTextIcon className="size-4 shrink-0" aria-hidden="true" />;
  return <FileTextIcon className="size-4 shrink-0" aria-hidden="true" />;
}

export function ItemSidebar({
  items,
  selectedId,
  busyItemId,
  uploads,
  disabled = false,
  maxFiles,
  maxItems,
  onSelect,
  onAddCode,
  onAddText,
  onUpload,
  onMove,
  onDelete,
}: ItemSidebarProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const fileCount = items.filter((item) => item.type === "file").length;
  const atItemLimit = items.length >= maxItems;
  const atFileLimit = fileCount >= maxFiles;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={onAddCode}
          disabled={disabled || atItemLimit}
        >
          <PlusIcon aria-hidden="true" />
          Code
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={onAddText}
          disabled={disabled || atItemLimit}
        >
          <PlusIcon aria-hidden="true" />
          Note
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || atItemLimit || atFileLimit}
        >
          <UploadIcon aria-hidden="true" />
          Upload
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="sr-only"
          aria-label="Upload files into this collection"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length > 0) onUpload(files);
          }}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {items.length}/{maxItems} items · {fileCount}/{maxFiles} files
      </p>

      <Separator />

      {uploads.length > 0 ? (
        <ul className="space-y-2" aria-live="polite">
          {uploads.map((upload) => (
            <li key={upload.id} className="space-y-1 rounded-md border p-2">
              <div className="flex items-center gap-2 text-xs">
                <Loader2Icon className="size-3 animate-spin" aria-hidden="true" />
                <span className="truncate">{upload.filename}</span>
                <span className="ml-auto tabular-nums text-muted-foreground">
                  {upload.percent}%
                </span>
              </div>
              <Progress value={upload.percent} aria-label={`Uploading ${upload.filename}`} />
            </li>
          ))}
        </ul>
      ) : null}

      {items.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          This collection is empty. Add a code snippet, a note, or upload a file.
        </p>
      ) : (
        <ul className="flex-1 space-y-1 overflow-y-auto pr-1" aria-label="Collection items">
          {items.map((item, index) => {
            const selected = item.id === selectedId;
            return (
              <li key={item.id}>
                <div
                  className={`group flex items-center gap-2 rounded-md border p-2 text-sm transition-colors ${
                    selected
                      ? "border-primary/60 bg-accent"
                      : "border-transparent hover:bg-accent/60"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(item.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    aria-current={selected ? "true" : undefined}
                  >
                    <ItemIcon item={item} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{item.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.type === "file"
                          ? `${item.file?.originalFilename ?? "file"} · ${formatBytes(item.file?.sizeBytes ?? 0)}`
                          : item.type === "code"
                            ? (item.language ?? "plaintext")
                            : "note"}
                      </span>
                    </span>
                    {busyItemId === item.id ? (
                      <Loader2Icon className="size-3 animate-spin" aria-hidden="true" />
                    ) : null}
                  </button>

                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label={`Move ${item.title} up`}
                      disabled={disabled || index === 0}
                      onClick={() => onMove(item.id, -1)}
                    >
                      <ChevronUpIcon className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label={`Move ${item.title} down`}
                      disabled={disabled || index === items.length - 1}
                      onClick={() => onMove(item.id, 1)}
                    >
                      <ChevronDownIcon className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7 text-destructive hover:text-destructive"
                      aria-label={`Delete ${item.title}`}
                      disabled={disabled}
                      onClick={() => onDelete(item.id)}
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
