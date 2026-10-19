"use client";

import { ArchiveIcon, DownloadIcon, FileWarningIcon, ImageOffIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import type { PreviewPayload, ShareItemSummary } from "@/types";

/**
 * Server-prepared file previews.
 *
 * The bytes themselves always come from the authorized content route; this
 * component only decides how to present the server's classification. Markdown
 * arrives already sanitized by the server (HTML disabled + allowlist), so the
 * single `dangerouslySetInnerHTML` call is deliberate and documented.
 */

export interface FilePreviewProps {
  preview: PreviewPayload;
  item: ShareItemSummary;
  contentUrl: string;
}

export function FilePreview({ preview, item, contentUrl }: FilePreviewProps) {
  const filename = item.file?.originalFilename ?? item.title;

  if (preview.kind === "markdown") {
    return (
      <div className="space-y-3">
        <div className="cs-markdown" dangerouslySetInnerHTML={{ __html: preview.html }} />
        {preview.truncated ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
            Preview truncated at the configured size limit. Download the file for the full content.
          </p>
        ) : null}
      </div>
    );
  }

  if (preview.kind === "csv") {
    const { columns, rows, rowCount, truncatedRows, truncatedColumns, parseErrors } = preview.table;
    return (
      <div className="space-y-3">
        <div className="max-h-[65vh] overflow-auto rounded-lg border">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-muted">
              <tr>
                {columns.map((column, index) => (
                  <th
                    key={`${column}-${index}`}
                    scope="col"
                    className="border-b px-3 py-2 text-left font-medium whitespace-nowrap"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="odd:bg-muted/30">
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className="border-b px-3 py-1.5 font-mono text-xs whitespace-nowrap"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          {rowCount} {rowCount === 1 ? "row" : "rows"} shown
          {truncatedRows ? " (row cap reached)" : ""}
          {truncatedColumns ? " · extra columns omitted" : ""}
          {parseErrors > 0 ? ` · ${parseErrors} parse warning(s)` : ""}
        </p>
      </div>
    );
  }

  if (preview.kind === "text") {
    return (
      <div className="space-y-3">
        <pre className="max-h-[65vh] overflow-auto rounded-lg border bg-muted/30 p-4 text-xs leading-relaxed whitespace-pre-wrap">
          {preview.text}
        </pre>
        <p className="text-xs text-muted-foreground">
          {preview.language ? `${preview.language} · ` : ""}
          {formatBytes(item.file?.sizeBytes ?? 0)}
          {preview.truncated ? " · truncated preview" : ""}
        </p>
      </div>
    );
  }

  if (preview.kind === "image") {
    return (
      <div className="space-y-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- authorized same-origin stream with unknown intrinsic size */}
        <img
          src={contentUrl}
          alt={filename}
          className="mx-auto max-h-[70vh] max-w-full rounded-lg border object-contain"
        />
        <p className="text-center text-xs text-muted-foreground">
          {preview.mimeType ?? "image"} · {formatBytes(preview.sizeBytes)}
        </p>
      </div>
    );
  }

  if (preview.kind === "pdf") {
    return (
      <div className="space-y-3">
        <iframe
          src={contentUrl}
          title={`PDF preview of ${filename}`}
          className="h-[75vh] w-full rounded-lg border bg-white"
        />
        <p className="text-xs text-muted-foreground">
          {formatBytes(preview.sizeBytes)} · If the built-in viewer is blocked, download the file.
        </p>
      </div>
    );
  }

  if (preview.kind === "audio") {
    return (
      <div className="space-y-3 rounded-lg border p-6">
        <audio controls src={contentUrl} className="w-full">
          Your browser does not support audio playback.
        </audio>
        <p className="text-xs text-muted-foreground">{formatBytes(preview.sizeBytes)}</p>
      </div>
    );
  }

  if (preview.kind === "video") {
    return (
      <div className="space-y-3">
        <video controls src={contentUrl} className="max-h-[70vh] w-full rounded-lg border">
          Your browser does not support video playback.
        </video>
        <p className="text-xs text-muted-foreground">{formatBytes(preview.sizeBytes)}</p>
      </div>
    );
  }

  if (preview.kind === "archive") {
    return (
      <div className="space-y-3 rounded-lg border border-dashed p-8 text-center">
        <ArchiveIcon className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium">Archive file</p>
        <p className="text-sm text-muted-foreground">
          {formatBytes(preview.sizeBytes)} · Archives are never expanded on the server. Download it
          to inspect the contents.
        </p>
        <Button asChild variant="secondary">
          <a href={`${contentUrl}?download=1`} download>
            <DownloadIcon aria-hidden="true" />
            Download archive
          </a>
        </Button>
      </div>
    );
  }

  // unsupported / download-only (HTML, SVG, executables, unknown binaries).
  // (`kind` is grouped for the media variants, so the reason is narrowed here.)
  const reason =
    preview.kind === "unsupported"
      ? preview.reason
      : "This file can be downloaded but not previewed inline.";
  const icon = preview.mimeType?.startsWith("image/") ? (
    <ImageOffIcon className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
  ) : (
    <FileWarningIcon className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
  );
  return (
    <div className="space-y-3 rounded-lg border border-dashed p-8 text-center">
      {icon}
      <p className="font-medium">No inline preview</p>
      <p className="mx-auto max-w-md text-sm text-muted-foreground">{reason}</p>
      <p className="text-xs text-muted-foreground">
        {preview.mimeType ?? "application/octet-stream"} · {formatBytes(preview.sizeBytes)}
      </p>
      <Button asChild variant="secondary">
        <a href={`${contentUrl}?download=1`} download>
          <DownloadIcon aria-hidden="true" />
          Download file
        </a>
      </Button>
    </div>
  );
}
