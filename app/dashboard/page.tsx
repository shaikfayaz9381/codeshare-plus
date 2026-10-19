import type { Metadata } from "next";
import Link from "next/link";
import {
  ArchiveIcon,
  ClockIcon,
  FolderIcon,
  KeyRoundIcon,
  LockIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react";

import { ShareRowActions } from "@/components/dashboard/share-row-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { signOutAction } from "@/app/login/actions";
import { appUrl } from "@/lib/config/env";
import { toPublicShare } from "@/lib/db/rows";
import { describeRemaining, formatBytes, formatDateTime } from "@/lib/format";
import { getPageAccessContext } from "@/lib/services/context";
import { listSharesForActor, shareStatus } from "@/lib/services/shares";
import { getSupabaseUser, supabaseConfigured } from "@/lib/supabase/server";
import { dashboardQuerySchema } from "@/lib/validation/schemas";

/**
 * `/dashboard` — collections owned by the current actor.
 *
 * Works for both signed-in users and guest sessions (capability cookie). The
 * page calls the application services directly; row mutations go through the
 * authorized API routes. Search/filter/pagination are plain GET navigations so
 * the page works without client-side data fetching.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Manage the collections you own.",
  robots: { index: false, follow: false },
};

type ShareStatus = "active" | "expired" | "revoked";

interface DashboardShare {
  shareId: string;
  title: string;
  description: string | null;
  visibility: "public" | "unlisted";
  hasPassword: boolean;
  expiresAt: string | null;
  createdAt: string;
  itemCount: number;
  totalBytes: number;
  status: ShareStatus;
  url: string;
}

const STATUS_LABEL: Record<ShareStatus, string> = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
};

function pageHref(
  params: { q?: string; visibility?: string; status: string; sort: string },
  page: number,
): string {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.visibility) query.set("visibility", params.visibility);
  if (params.status !== "all") query.set("status", params.status);
  if (params.sort !== "created_desc") query.set("sort", params.sort);
  if (page > 1) query.set("page", String(page));
  const suffix = query.toString();
  return suffix ? `/dashboard?${suffix}` : "/dashboard";
}

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const params = await searchParams;
  const raw = {
    q: typeof params.q === "string" ? params.q : undefined,
    visibility:
      params.visibility === "public" || params.visibility === "unlisted"
        ? params.visibility
        : undefined,
    status:
      typeof params.status === "string" &&
      ["active", "expired", "revoked", "password", "all"].includes(params.status)
        ? params.status
        : "all",
    sort:
      typeof params.sort === "string" &&
      ["created_desc", "created_asc", "updated_desc", "title_asc"].includes(params.sort)
        ? params.sort
        : "created_desc",
    page: Number(params.page) || 1,
    perPage: 12,
  };

  const parsed = dashboardQuerySchema.safeParse(raw);
  const filter = parsed.success
    ? parsed.data
    : dashboardQuerySchema.parse({ q: raw.q?.slice(0, 100), status: raw.status, sort: raw.sort });

  const context = await getPageAccessContext();
  const anonymous = context.actor.kind === "anonymous";
  const account = context.actor.kind === "user" ? await getSupabaseUser() : null;

  let pageData: Awaited<ReturnType<typeof listSharesForActor>> | null = null;
  let allCount = 0;
  let activeCount = 0;
  let expiredCount = 0;
  let revokedCount = 0;

  if (!anonymous) {
    const [page, all, active, expired, revoked] = await Promise.all([
      listSharesForActor(context, filter),
      listSharesForActor(context, { page: 1, perPage: 1, status: "all" }),
      listSharesForActor(context, { page: 1, perPage: 1, status: "active" }),
      listSharesForActor(context, { page: 1, perPage: 1, status: "expired" }),
      listSharesForActor(context, { page: 1, perPage: 1, status: "revoked" }),
    ]);
    pageData = page;
    allCount = all.total;
    activeCount = active.total;
    expiredCount = expired.total;
    revokedCount = revoked.total;
  }

  const shares: DashboardShare[] = (pageData?.shares ?? []).map((row) => {
    const share = toPublicShare(row, { includeTotals: true });
    return {
      shareId: share.shareId,
      title: share.title,
      description: share.description,
      visibility: share.visibility,
      hasPassword: share.hasPassword,
      expiresAt: share.expiresAt,
      createdAt: share.createdAt,
      itemCount: share.itemCount,
      totalBytes: share.totalBytes ?? 0,
      status: shareStatus(row),
      url: `${appUrl()}/s/${share.shareId}`,
    };
  });

  const totalPages = pageData ? Math.max(1, Math.ceil(pageData.total / pageData.perPage)) : 1;
  const hasFilters = Boolean(filter.q) || filter.status !== "all" || Boolean(filter.visibility);

  if (anonymous) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6">
        <Card>
          <CardHeader className="text-center">
            <FolderIcon className="mx-auto mb-2 size-10 text-muted-foreground" aria-hidden="true" />
            <CardTitle className="text-2xl">No sessions on this browser yet</CardTitle>
            <CardDescription className="mx-auto max-w-lg text-base">
              Guest collections are linked to the browser that created them through a secure,
              HttpOnly cookie. Create one to start your dashboard — no account required.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col justify-center gap-2 sm:flex-row">
            <Button asChild>
              <Link href="/new">
                <PlusIcon aria-hidden="true" />
                Create a collection
              </Link>
            </Button>
            {supabaseConfigured() ? (
              <Button asChild variant="outline">
                <Link href="/login">Sign in</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-8 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight">Your collections</h1>
            <p className="text-sm text-muted-foreground">
              {account ? (
                <>
                  Signed in as {account.displayName ?? account.email ?? "your account"}.
                  {account.email && account.displayName ? ` (${account.email})` : ""}
                </>
              ) : (
                <>Guest session on this browser. Clearing cookies removes dashboard access.</>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {account ? (
              <form action={signOutAction}>
                <Button type="submit" variant="ghost" size="sm">
                  Sign out
                </Button>
              </form>
            ) : supabaseConfigured() ? (
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">Sign in</Link>
              </Button>
            ) : null}
            <Button asChild>
              <Link href="/new">
                <PlusIcon aria-hidden="true" />
                New collection
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card className="py-4">
            <CardContent className="flex items-center gap-3">
              <FolderIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="text-2xl font-semibold">{allCount}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
            </CardContent>
          </Card>
          <Card className="py-4">
            <CardContent className="flex items-center gap-3">
              <KeyRoundIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="text-2xl font-semibold">{activeCount}</p>
                <p className="text-xs text-muted-foreground">Active</p>
              </div>
            </CardContent>
          </Card>
          <Card className="py-4">
            <CardContent className="flex items-center gap-3">
              <ClockIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="text-2xl font-semibold">{expiredCount}</p>
                <p className="text-xs text-muted-foreground">Expired</p>
              </div>
            </CardContent>
          </Card>
          <Card className="py-4">
            <CardContent className="flex items-center gap-3">
              <ArchiveIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="text-2xl font-semibold">{revokedCount}</p>
                <p className="text-xs text-muted-foreground">Revoked</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </header>

      <form
        action="/dashboard"
        method="get"
        className="mb-5 flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center"
      >
        <div className="relative flex-1">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            name="q"
            defaultValue={filter.q ?? ""}
            placeholder="Search title or description"
            maxLength={100}
            aria-label="Search collections"
            className="pl-8"
          />
        </div>
        <select
          name="status"
          defaultValue={filter.status}
          aria-label="Filter by status"
          className="h-9 rounded-md border bg-transparent px-2 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="expired">Expired</option>
          <option value="revoked">Revoked</option>
          <option value="password">Password protected</option>
        </select>
        <select
          name="visibility"
          defaultValue={filter.visibility ?? ""}
          aria-label="Filter by visibility"
          className="h-9 rounded-md border bg-transparent px-2 text-sm"
        >
          <option value="">Any visibility</option>
          <option value="public">Public</option>
          <option value="unlisted">Unlisted</option>
        </select>
        <select
          name="sort"
          defaultValue={filter.sort}
          aria-label="Sort collections"
          className="h-9 rounded-md border bg-transparent px-2 text-sm"
        >
          <option value="created_desc">Newest first</option>
          <option value="created_asc">Oldest first</option>
          <option value="updated_desc">Recently updated</option>
          <option value="title_asc">Title A–Z</option>
        </select>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
        {hasFilters ? (
          <Button asChild variant="ghost">
            <Link href="/dashboard">Reset</Link>
          </Button>
        ) : null}
      </form>

      {shares.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="font-medium">
              {hasFilters ? "No collections match these filters." : "No collections yet."}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {hasFilters
                ? "Try a different search or reset the filters."
                : "Your first collection can hold code, notes, and files behind one link."}
            </p>
            <Button asChild className="mt-5">
              <Link href={hasFilters ? "/dashboard" : "/new"}>
                {hasFilters ? "Reset filters" : "Create a collection"}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {shares.map((share) => (
            <Card key={share.shareId}>
              <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/manage/${encodeURIComponent(share.shareId)}`}
                      className="truncate font-medium hover:underline"
                    >
                      {share.title}
                    </Link>
                    <Badge
                      variant={
                        share.status === "revoked"
                          ? "destructive"
                          : share.status === "expired"
                            ? "outline"
                            : "secondary"
                      }
                    >
                      {STATUS_LABEL[share.status]}
                    </Badge>
                    <Badge variant="outline">
                      {share.visibility === "public" ? "Public" : "Unlisted"}
                    </Badge>
                    {share.hasPassword ? (
                      <Badge variant="outline">
                        <LockIcon className="size-3" aria-hidden="true" />
                        Password
                      </Badge>
                    ) : null}
                  </div>
                  {share.description ? (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {share.description}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {share.itemCount} {share.itemCount === 1 ? "item" : "items"}
                    {share.totalBytes > 0 ? ` · ${formatBytes(share.totalBytes)}` : ""} · created{" "}
                    {formatDateTime(share.createdAt)}
                    {share.status === "active" && share.expiresAt
                      ? ` · ${describeRemaining(share.expiresAt)}`
                      : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <ShareRowActions
                    shareId={share.shareId}
                    title={share.title}
                    url={share.url}
                    revoked={share.status === "revoked"}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {pageData && pageData.total > 0 ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <p>
            Showing {(pageData.page - 1) * pageData.perPage + 1}–
            {Math.min(pageData.page * pageData.perPage, pageData.total)} of {pageData.total}
          </p>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm" aria-disabled={filter.page <= 1}>
              <Link
                href={pageHref(filter, Math.max(1, filter.page - 1))}
                aria-disabled={filter.page <= 1}
                tabIndex={filter.page <= 1 ? -1 : undefined}
                className={filter.page <= 1 ? "pointer-events-none opacity-50" : undefined}
              >
                Previous
              </Link>
            </Button>
            <span aria-live="polite">
              Page {pageData.page} of {totalPages}
            </span>
            <Button asChild variant="outline" size="sm">
              <Link
                href={pageHref(filter, Math.min(totalPages, filter.page + 1))}
                aria-disabled={filter.page >= totalPages}
                tabIndex={filter.page >= totalPages ? -1 : undefined}
                className={filter.page >= totalPages ? "pointer-events-none opacity-50" : undefined}
              >
                Next
              </Link>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
