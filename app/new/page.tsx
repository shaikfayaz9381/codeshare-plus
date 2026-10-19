import type { Metadata } from "next";

import { ShareBuilder } from "@/components/builder/share-builder";
import { formatBytes } from "@/lib/format";
import { limits } from "@/lib/config/env";

/**
 * `/new` — the share builder.
 *
 * Limits are read on the server and passed to the client shell so the UI can
 * disable actions that the API would reject (the API enforces them again).
 * Rendered per request: the builder creates a guest capability cookie and every
 * value comes from live configuration.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "New collection",
  description:
    "Bundle code snippets, notes, and files into one shareable link with a password, an expiry, and download controls.",
  alternates: { canonical: "/new" },
  robots: { index: false, follow: false },
};

export default function NewSharePage() {
  const config = limits();

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
      <header className="mb-8 space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">New collection</h1>
        <p className="max-w-2xl text-muted-foreground">
          Add code snippets, notes, and files, then share one link. Uploads are stored privately and
          streamed through authorized routes. Limits: {config.maxItemsPerShare} items,{" "}
          {config.maxFilesPerShare} files, {formatBytes(config.maxUploadBytes)} per file.
        </p>
      </header>

      <ShareBuilder
        maxItems={config.maxItemsPerShare}
        maxFiles={config.maxFilesPerShare}
        maxUploadBytes={config.maxUploadBytes}
      />
    </div>
  );
}
