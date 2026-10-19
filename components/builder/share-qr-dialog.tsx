"use client";

import * as React from "react";
import { Loader2Icon, QrCodeIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * QR code for a share URL, generated in the browser on demand.
 *
 * `qrcode` is imported dynamically so the encoder (about 50 KB) is only fetched
 * when someone actually opens the dialog. The image itself is a data URL; no
 * request leaves the page, and the URL never touches a third-party service.
 */

export interface ShareQrDialogProps {
  url: string;
  disabled?: boolean;
}

export function ShareQrDialog({ url, disabled = false }: ShareQrDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [dataUrl, setDataUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!open || dataUrl || failed || !url) return;
    let cancelled = false;
    void (async () => {
      try {
        const QRCode = await import("qrcode");
        const next = await QRCode.toDataURL(url, {
          width: 512,
          margin: 1,
          errorCorrectionLevel: "M",
        });
        if (!cancelled) setDataUrl(next);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, dataUrl, failed, url]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" disabled={disabled}>
          <QrCodeIcon aria-hidden="true" />
          QR
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Scan to open</DialogTitle>
          <DialogDescription>
            Point a phone camera at the code. Access rules still apply on the receiving device.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-[240px] items-center justify-center">
          {dataUrl ? (
            // Same-origin data URL generated above; next/image adds no value for
            // a 512px raster with no remote loader.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={dataUrl}
              alt={`QR code that opens ${url}`}
              width={240}
              height={240}
              className="rounded-lg border bg-white p-2"
            />
          ) : failed ? (
            <p className="text-center text-sm text-destructive">
              The QR code could not be generated in this browser. Copy the link instead.
            </p>
          ) : (
            <Loader2Icon className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <p className="text-center font-mono text-xs break-all text-muted-foreground">{url}</p>
      </DialogContent>
    </Dialog>
  );
}
