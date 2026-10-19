"use client";

import { DownloadIcon, EyeIcon, Loader2Icon, SaveIcon } from "lucide-react";

import { CodeEditor } from "@/components/code-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatBytes, formatDateTime } from "@/lib/format";
import { CODE_LANGUAGES, type ShareItemDetail, type ShareItemSummary } from "@/types";

/**
 * Editor panel for the selected item.
 *
 * - `code` items get the CodeMirror editor plus a language selector
 * - `text` items get a plain textarea (notes are prose, not code)
 * - `file` items show metadata and authorized download links
 *
 * The panel renders the *draft* (owned by the builder), so pending edits stay
 * visible until they are saved or discarded.
 */

export interface ItemDraft {
  title: string;
  content: string;
  language: string | null;
}

export interface ItemEditorProps {
  shareId: string;
  item: ShareItemDetail;
  summary: ShareItemSummary;
  draft: ItemDraft;
  dirty: boolean;
  saving: boolean;
  canDownload: boolean;
  onDraftChange: (draft: ItemDraft) => void;
  onSave: () => void;
  onReload: () => void;
}

export function ItemEditor({
  shareId,
  item,
  summary,
  draft,
  dirty,
  saving,
  canDownload,
  onDraftChange,
  onSave,
  onReload,
}: ItemEditorProps) {
  const contentUrl = `/api/shares/${encodeURIComponent(shareId)}/items/${encodeURIComponent(item.id)}/content`;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1 space-y-1">
          <Label htmlFor="item-title">Title</Label>
          <Input
            id="item-title"
            value={draft.title}
            maxLength={200}
            onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
          />
        </div>

        {item.type === "code" ? (
          <div className="w-[190px] space-y-1">
            <Label htmlFor="item-language">Language</Label>
            <Select
              value={draft.language ?? "plaintext"}
              onValueChange={(value) => onDraftChange({ ...draft, language: value })}
            >
              <SelectTrigger id="item-language" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CODE_LANGUAGES.map((language) => (
                  <SelectItem key={language} value={language}>
                    {language}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {item.type !== "file" ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onReload}
              disabled={!dirty || saving}
            >
              Discard changes
            </Button>
            <Button type="button" size="sm" onClick={onSave} disabled={!dirty || saving}>
              {saving ? (
                <Loader2Icon className="animate-spin" aria-hidden="true" />
              ) : (
                <SaveIcon aria-hidden="true" />
              )}
              Save
            </Button>
          </div>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        {dirty ? "Unsaved changes · " : ""}
        {item.type === "file"
          ? "Uploaded file"
          : item.type === "code"
            ? "Code snippet"
            : "Text note"}
        {" · updated "}
        {formatDateTime(item.updatedAt)}
      </p>

      {item.type === "file" ? (
        <div className="space-y-4 rounded-lg border p-5">
          <p className="font-medium">{summary.file?.originalFilename ?? summary.title}</p>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Size</dt>
              <dd>{formatBytes(summary.file?.sizeBytes ?? 0)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Detected type</dt>
              <dd className="font-mono text-xs">
                {summary.file?.mimeType ?? "application/octet-stream"}
              </dd>
            </div>
          </dl>
          {canDownload ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="secondary">
                <a href={contentUrl} download>
                  <DownloadIcon aria-hidden="true" />
                  Download
                </a>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <a href={contentUrl} target="_blank" rel="noreferrer">
                  <EyeIcon aria-hidden="true" />
                  Open
                </a>
              </Button>
            </div>
          ) : (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              Downloads are disabled for this collection, so the file cannot be fetched — not even
              by you. Enable “Allow downloads” in the settings to open it.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Files are stored privately and streamed through an authorized route; content is sniffed
            by magic bytes, so HTML and SVG are always served as attachments.
          </p>
        </div>
      ) : item.type === "code" ? (
        <div className="min-h-[360px] flex-1 overflow-hidden rounded-lg border">
          <CodeEditor
            value={draft.content}
            language={draft.language}
            onChange={(value) => onDraftChange({ ...draft, content: value })}
            onSave={onSave}
            ariaLabel={`Code for ${draft.title}`}
          />
        </div>
      ) : (
        <Textarea
          aria-label={`Content of ${draft.title}`}
          className="min-h-[360px] flex-1 font-mono text-sm"
          value={draft.content}
          onChange={(event) => onDraftChange({ ...draft, content: event.target.value })}
        />
      )}
    </div>
  );
}
