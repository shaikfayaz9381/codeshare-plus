import Link from "next/link";

const FOOTER_LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#security", label: "Security" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/api/health", label: "Service status" },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium">CodeShare Plus</p>
          <p className="text-sm text-muted-foreground">Share code, files, and ideas in one link.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {FOOTER_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
