import type { Metadata } from "next";
import Link from "next/link";
import {
  ArchiveIcon,
  ArrowRightIcon,
  Code2Icon,
  EyeIcon,
  FileUpIcon,
  KeyRoundIcon,
  LockIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TimerIcon,
  UserRoundIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Share code, files, and ideas in one link",
  description:
    "Bundle snippets, notes, and files into a single shareable link. Add a password, set an expiry, and revoke access at any time — no account required.",
  alternates: { canonical: "/" },
};

const FEATURES = [
  {
    icon: SparklesIcon,
    title: "One link, many items",
    body: "Mix code snippets, plain-text notes, and uploaded files in a single collection instead of scattering seven gists and three drives links.",
  },
  {
    icon: Code2Icon,
    title: "A real code editor",
    body: "CodeMirror with syntax highlighting for JavaScript, TypeScript, Python, Go, Rust, SQL, YAML, and more — plus a plain-text mode for everything else.",
  },
  {
    icon: FileUpIcon,
    title: "Uploads that stay private",
    body: "Files live in private object storage behind signed, server-authorized routes. Storage keys and URLs are never exposed to the browser.",
  },
  {
    icon: KeyRoundIcon,
    title: "Passwords and expiry",
    body: "Protect a link with a bcrypt-hashed password, choose a lifetime from one hour to never, and revoke access instantly when a link leaks.",
  },
  {
    icon: EyeIcon,
    title: "Previews that are safe",
    body: "Markdown is sanitized on the server, CSV is row-capped, and active content (HTML, SVG) is always downloaded, never rendered inline.",
  },
  {
    icon: ArchiveIcon,
    title: "Download everything at once",
    body: "Recipients can grab a ZIP of the whole collection — or just preview the parts they need, item by item.",
  },
  {
    icon: UserRoundIcon,
    title: "Guest-first, account-optional",
    body: "Create and manage shares without signing up. Your guest session is a hashed capability cookie; link it to an account later if you want.",
  },
  {
    icon: TimerIcon,
    title: "Abuse controls built in",
    body: "PostgreSQL-backed rate limits and quotas survive serverless scaling, so one client cannot exhaust your storage or hammer a password gate.",
  },
] as const;

const STEPS = [
  {
    step: "1",
    title: "Build the collection",
    body: "Add code tabs, notes, and files. Reorder them until the story reads the way you want.",
  },
  {
    step: "2",
    title: "Set the rules",
    body: "Pick an expiry, optionally add a password, and decide whether recipients may download the originals.",
  },
  {
    step: "3",
    title: "Share and manage",
    body: "Send one URL. Track it in your dashboard, rotate the password, or revoke the link with a click.",
  },
] as const;

const SECURITY_POINTS = [
  "Authorization is evaluated on the server for every request — the UI never decides who may read or download.",
  "Share passwords are bcrypt-hashed; guest and access tokens are stored only as SHA-256 hashes.",
  "Row Level Security is enabled on every table as defence in depth behind the application layer.",
  "Uploads are sniffed by magic bytes, so a renamed executable is never served as an image.",
  "Responses carry a strict Content Security Policy, nosniff headers, and attachment-only downloads for risky types.",
  "Every table is validated with Zod at the API boundary; client-supplied ids and sizes are never trusted.",
] as const;

export default function HomePage() {
  return (
    <div className="flex flex-col">
      <section className="relative overflow-hidden border-b">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:64px_64px] opacity-40"
        />
        <div className="relative mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <div className="max-w-3xl">
            <Badge variant="secondary" className="mb-6 gap-1.5">
              <ShieldCheckIcon className="size-3.5" aria-hidden="true" />
              Guest-first · password, expiry &amp; revoke controls
            </Badge>
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl md:text-6xl">
              Share code, files, and ideas in one link.
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-muted-foreground text-pretty">
              CodeShare Plus turns snippets, notes, and uploads into a single tidy collection with a
              URL you control. Add a password, set an expiry, and take it all back whenever you
              like.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/new">
                  Create a share
                  <ArrowRightIcon aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/#how-it-works">See how it works</Link>
              </Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              No account needed to start. Sign in later to keep your collections in one place.
            </p>
          </div>
        </div>
      </section>

      <section id="features" className="scroll-mt-20 border-b py-20 sm:py-24">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Everything a disposable file dump forgets
            </h2>
            <p className="mt-4 text-muted-foreground">
              Built as a real application, not a paste box: persistent PostgreSQL collections,
              private storage, and access rules that hold up when someone reposts your link.
            </p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature) => (
              <Card key={feature.title} className="h-full">
                <CardHeader>
                  <span className="mb-2 flex size-9 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                    <feature.icon className="size-4" aria-hidden="true" />
                  </span>
                  <CardTitle className="text-base">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>{feature.body}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-20 border-b py-20 sm:py-24">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">How it works</h2>
            <p className="mt-4 text-muted-foreground">
              Three steps from a messy folder to one clean, controllable link.
            </p>
          </div>
          <ol className="mt-12 grid gap-4 md:grid-cols-3">
            {STEPS.map((entry) => (
              <li key={entry.step}>
                <Card className="h-full">
                  <CardHeader>
                    <span className="flex size-8 items-center justify-center rounded-full border text-sm font-medium">
                      {entry.step}
                    </span>
                    <CardTitle className="text-base">{entry.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription>{entry.body}</CardDescription>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="security" className="scroll-mt-20 border-b py-20 sm:py-24">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16">
          <div>
            <span className="flex size-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
              <LockIcon className="size-5" aria-hidden="true" />
            </span>
            <h2 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">
              Security you can audit
            </h2>
            <p className="mt-4 text-muted-foreground">
              Every claim on this page maps to code in this repository — no security theatre. The
              README documents exactly what is implemented and what is left to verify against your
              own Supabase project.
            </p>
          </div>
          <ul className="space-y-4">
            {SECURITY_POINTS.map((point) => (
              <li key={point} className="flex gap-3 text-sm text-muted-foreground">
                <ShieldCheckIcon
                  className="mt-0.5 size-4 shrink-0 text-foreground"
                  aria-hidden="true"
                />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="py-20 sm:py-24">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl sm:text-3xl">Ready to share something?</CardTitle>
              <CardDescription className="text-base">
                Start a collection now — you can always protect or delete it later.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/new">
                  Create a share
                  <ArrowRightIcon aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/api/health">Check service status</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
