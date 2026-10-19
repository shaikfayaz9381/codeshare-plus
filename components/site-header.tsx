import Link from "next/link";
import { Code2Icon } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

/**
 * Marketing / application header.
 *
 * Deliberately static (no auth state) so it can render on every page without
 * database access; account-aware UI lives on /dashboard and /login.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Code2Icon className="size-4" aria-hidden="true" />
          </span>
          <span>
            CodeShare<span className="text-muted-foreground"> Plus</span>
          </span>
          <span className="sr-only">— home</span>
        </Link>

        <nav aria-label="Main" className="ml-4 hidden items-center gap-1 md:flex">
          <Button asChild variant="ghost" size="sm">
            <Link href="/#features">Features</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/#security">Security</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/#how-it-works">How it works</Link>
          </Button>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/dashboard">Dashboard</Link>
          </Button>
          <ThemeToggle />
          <Button asChild size="sm">
            <Link href="/new">New share</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
