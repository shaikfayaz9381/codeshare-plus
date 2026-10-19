"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, ClockIcon, Loader2Icon, LockIcon, ShieldOffIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, ApiError } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import type { GateShare } from "@/types";

/**
 * Gate screens shown instead of a collection when the caller may not read it:
 * password prompt, expired link, or revoked link. Only the gate projection of
 * the share is available here (title, description, owner, expiry).
 */

export interface ShareGateProps {
  state: "password_required" | "expired" | "revoked";
  share: GateShare;
}

export function ShareGate({ state, share }: ShareGateProps) {
  const router = useRouter();
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function unlock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length === 0) {
      setError("Enter the password to continue.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/api/shares/${encodeURIComponent(share.shareId)}/password`, {
        method: "POST",
        json: { password },
      });
      // The grant cookie is now set; re-render the server component as an
      // authorized reader.
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "The password could not be verified. Please try again.",
      );
      setSubmitting(false);
    }
  }

  const icon =
    state === "password_required" ? (
      <LockIcon className="size-4" aria-hidden="true" />
    ) : state === "expired" ? (
      <ClockIcon className="size-4" aria-hidden="true" />
    ) : (
      <ShieldOffIcon className="size-4" aria-hidden="true" />
    );

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col justify-center px-4 py-16 sm:px-6">
      <Card>
        <CardHeader className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            {icon}
            {state === "password_required"
              ? "Password required"
              : state === "expired"
                ? "This link has expired"
                : "This link was revoked"}
          </p>
          <CardTitle className="text-2xl">{share.title}</CardTitle>
          {share.description ? (
            <CardDescription className="text-base">{share.description}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-5">
          <dl className="grid gap-1 text-sm text-muted-foreground">
            {share.ownerDisplayName ? (
              <div className="flex gap-2">
                <dt>Shared by</dt>
                <dd className="text-foreground">{share.ownerDisplayName}</dd>
              </div>
            ) : null}
            <div className="flex gap-2">
              <dt>Created</dt>
              <dd className="text-foreground">{formatDateTime(share.createdAt)}</dd>
            </div>
            {share.expiresAt ? (
              <div className="flex gap-2">
                <dt>Expires</dt>
                <dd className="text-foreground">{formatDateTime(share.expiresAt)}</dd>
              </div>
            ) : null}
          </dl>

          {state === "password_required" ? (
            <form onSubmit={unlock} className="space-y-3" noValidate>
              <div className="space-y-2">
                <Label htmlFor="share-password">Password</Label>
                <Input
                  id="share-password"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "share-password-error" : undefined}
                />
              </div>
              {error ? (
                <p id="share-password-error" role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
                Unlock collection
              </Button>
              <p className="text-xs text-muted-foreground">
                Passwords are verified on the server. Attempts are rate limited.
              </p>
            </form>
          ) : (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                {state === "expired"
                  ? "The owner set an expiry date and it has passed. Ask them for a new link."
                  : "The owner revoked this link. Ask them for a replacement if you still need access."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
