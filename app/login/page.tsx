import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheckIcon } from "lucide-react";

import { LoginForm } from "@/components/auth/login-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabaseUser, supabaseConfigured } from "@/lib/supabase/server";

/**
 * `/login` — optional accounts.
 *
 * Guest sharing is the default and never requires an account. When Supabase
 * Auth is not configured the page explains that instead of presenting a form
 * that cannot work.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to CodeShare Plus to manage all of your collections.",
  robots: { index: false, follow: false },
};

function safeNext(value: string | string[] | undefined): string {
  if (typeof value !== "string") return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/dashboard";
  }
  return value;
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const mode = params.mode === "signup" ? "signup" : "signin";
  const next = safeNext(params.next);

  if (supabaseConfigured()) {
    const user = await getSupabaseUser();
    if (user) redirect("/dashboard");
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-4 py-16 sm:px-6">
      {supabaseConfigured() ? (
        <LoginForm mode={mode} next={next} />
      ) : (
        <Card className="w-full">
          <CardHeader className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-2xl">
              <ShieldCheckIcon className="size-5" aria-hidden="true" />
              Guest-only deployment
            </CardTitle>
            <CardDescription>
              Accounts are disabled because Supabase Auth is not configured on this instance.
              Everything else works without signing up.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Guest collections are tied to this browser through a secure, HttpOnly capability
              cookie. Keep using the same browser to find them on your dashboard. Clearing cookies
              loses guest access (the links themselves keep working).
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild className="flex-1">
                <Link href="/new">Create a collection</Link>
              </Button>
              <Button asChild variant="outline" className="flex-1">
                <Link href="/dashboard">Open dashboard</Link>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Operators can enable accounts by setting <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
              <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>; see the deployment guide.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
