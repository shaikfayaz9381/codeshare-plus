# CodeShare Plus

**Share code, files, and ideas in one link.**

CodeShare Plus bundles code snippets, notes, and uploaded files into a single shareable
collection with a URL you control: passwords, expiry dates, download rules, revocation, and a
guest-first workflow that never forces an account.

This is a real, full-stack Next.js application — persistent PostgreSQL, private object storage,
server-side authorization on every request — not a paste-bin demo.

> **Build status:** all seven phases are implemented. The vitest suites, the production build, and a
> Chromium end-to-end test (create → protect → view → export → revoke → delete) pass against a real
> PostgreSQL database. Supabase Auth/Storage code paths are written but **not verified against a live
> Supabase project** (no credentials here) — see [Project status](#project-status) and
> [Known limitations](#known-limitations). Nothing is claimed as verified unless a command in
> [Testing](#testing) actually produced that result.

---

## Table of contents

- [Features](#features)
- [Stack](#stack)
- [Quick start (no Supabase required)](#quick-start-no-supabase-required)
- [Environment variables](#environment-variables)
- [Database and migrations](#database-and-migrations)
- [Supabase setup (production)](#supabase-setup-production)
- [Architecture](#architecture)
- [Data model](#data-model)
- [HTTP API](#http-api)
- [Security model](#security-model)
- [Testing](#testing)
- [Scripts](#scripts)
- [Deployment](#deployment)
- [Project status](#project-status)
- [Known limitations](#known-limitations)

---

## Features

**Collections**

- One share holds many items: code snippets, plain-text notes, and uploaded files.
- Explicit ordering, rename, edit, delete, and per-item metadata (language, MIME type, size).
- Optional description, public/unlisted visibility, and per-share download permission.

**Sharing and access control**

- Unguessable 128-bit share IDs; optional bcrypt-hashed password with a rate-limited gate.
- Optional custom links (`/s/my-team-notes`): normalized, reserved names blocked, duplicates rejected
  with a 409; omitted → random id. (Links are permanent once created.)
- Expiry from one hour to never; revoke a link instantly (invalidates outstanding password grants).
- Guest-first management: a 256-bit capability token in an HttpOnly cookie (only its SHA-256 hash
  is stored server-side). Optional Supabase Auth accounts work alongside guests.
- Server-evaluated authorization for every read, preview, download, mutation, and export.
- Copy link, QR code (generated in the browser, no third-party service), open, revoke, delete.

**Viewer and dashboard**

- `/s/[shareId]`: server-rendered share page with password gate, expired/revoked screens, item
  navigation, and previews prepared by the server.
- `/dashboard`: every collection the current actor owns, with search, status/visibility filters,
  sorting, pagination, and per-row copy/open/manage/revoke/delete actions.
- `/manage/[shareId]`: the full builder for an existing collection (authorization re-checked on the
  server; knowing the share id is not enough).

**Files**

- Private storage by default: bytes are streamed through authorized routes, never via public URLs.
- Driver abstraction: Supabase Storage (production) or local filesystem (development/tests).
- Magic-byte type detection with a text/markup fallback; client-declared MIME types are ignored.
- Active content (HTML, SVG, XML) is always download-only, never rendered inline.
- Streaming ZIP export of a whole collection with entry and byte budgets.

**Previews**

- Markdown rendered server-side with HTML disabled, then sanitized through an allowlist.
- CSV/TSV parsed with row/column caps and rendered as a table; truncation is reported.
- Read-only CodeMirror for code, strict UTF-8 text previews, inline images, PDF (same-origin
  iframe only), audio/video streaming through the authorized content route.
- Archives and active content (HTML/SVG/XML) are download-only — never expanded or rendered.
- ZIP export of a whole collection with entry and byte budgets.

**Accounts (optional)**

- Supabase Auth sign-in/sign-up with HttpOnly session cookies; guests never see a login wall.
- When auth is not configured the app says so plainly instead of offering a broken form.

**Abuse resistance**

- PostgreSQL-backed counters (`consume_usage`) so rate limits hold across serverless instances.
- Quotas for share size, item count, file count, text item size, and guest upload bytes per day.
- Salted-hash rate-limit keys: raw IP addresses and user agents are never stored.

## Stack

| Concern    | Choice                                                                  |
| ---------- | ----------------------------------------------------------------------- |
| Framework  | Next.js 16 (App Router, Turbopack), React 19, TypeScript strict         |
| Styling    | Tailwind CSS v4, shadcn/ui (Radix primitives), Lucide icons, dark-first |
| Data       | PostgreSQL via `postgres.js` (Supabase in production)                   |
| Auth       | Supabase Auth (optional; guest mode needs no account)                   |
| Storage    | Supabase Storage (private bucket) or local filesystem driver            |
| Validation | Zod at every external boundary                                          |
| Forms      | React Hook Form + Zod resolvers                                         |
| Editor     | CodeMirror 6 (`@uiw/react-codemirror`)                                  |
| Archive    | JSZip (streamed)                                                        |
| Markdown   | markdown-it + sanitize-html (server-side)                               |
| File types | `file-type` (magic bytes)                                               |
| Passwords  | bcryptjs                                                                |
| Tests      | Vitest (unit + integration against real PostgreSQL)                     |

## Quick start (no Supabase required)

Prerequisites: **Node.js 22+** and npm. No Docker or root access needed — the development
database is a real PostgreSQL instance booted by `embedded-postgres`.

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env.local
#    then set DATABASE_URL to the URL printed by step 3 (already the default)

# 3. Start a local PostgreSQL instance (applies bootstrap + migrations, stays in foreground)
npm run dev:db

# 4. In a second terminal: start the app
npm run dev
```

Open http://localhost:3000. `GET /api/health` reports database, storage and auth status.

`STORAGE_DRIVER=local` writes uploaded objects to `.data/storage` (git-ignored). The local driver
is for development and automated tests only.

## Environment variables

Every variable is documented with defaults in [`.env.example`](./.env.example). Highlights:

| Variable                                    | Required        | Purpose                                                          |
| ------------------------------------------- | --------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`                              | yes             | PostgreSQL connection string used for all data access            |
| `NEXT_PUBLIC_APP_URL`                       | recommended     | Absolute origin used in share links and metadata                 |
| `STORAGE_DRIVER`                            | production: yes | `supabase` or `local`                                            |
| `SUPABASE_SERVICE_ROLE_KEY`                 | with `supabase` | Server-only key for private bucket operations; never expose it   |
| `NEXT_PUBLIC_SUPABASE_URL` / `..._ANON_KEY` | optional        | Required for accounts (Supabase Auth)                            |
| `HASH_SALT`                                 | production: yes | Salt for rate-limit/analytics hashes (`openssl rand -hex 32`)    |
| `BCRYPT_COST`                               | no (default 12) | bcrypt cost for share passwords (10–15)                          |
| `CRON_SECRET`                               | production: yes | Bearer secret for `/api/cron/maintenance`                        |
| `MAX_*`, `RATE_LIMIT_*`                     | no              | Upload/collection limits and abuse controls (see `.env.example`) |

`NEXT_PUBLIC_*` values are inlined **at build time** — set them before running `next build`
(on Vercel, that means in Project Settings → Environment Variables, for the build environment).

Configuration is validated lazily: `next build` works without secrets, and any operation that
needs a missing value fails with an actionable, secret-free error message. `GET /api/health`
always reports what is and is not configured.

## Database and migrations

Migrations live in [`supabase/migrations`](./supabase/migrations) and are applied in filename
order by a small runner (no framework lock-in):

| Migration              | Contents                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `..._init_schema.sql`  | Tables, constraints, indexes for shares, items, grants, reservations, counters, view stats                   |
| `..._functions.sql`    | `updated_at` triggers, atomic `consume_usage` / `peek_usage` / `usage_available`, pruning, profile bootstrap |
| `..._rls_policies.sql` | Row Level Security enabled on every table with ownership-based policies                                      |
| `..._storage.sql`      | Private `share-files` bucket plus a deny-by-default policy for client access                                 |

```bash
# Apply migrations to the database in DATABASE_URL
npm run db:migrate

# Apply Supabase-like stubs (auth/storage schemas, anon/authenticated/service_role roles)
# before migrating a *plain* PostgreSQL instance. Local development and tests only.
node scripts/db-migrate.mjs --bootstrap

# Wipe and re-create a local database from scratch (refuses in production unless CONFIRM_RESET=yes)
node scripts/db-migrate.mjs --reset --bootstrap
```

Applied versions are recorded in `public.applied_migrations`; every migration is idempotent.
On hosted Supabase, either run the runner against the pooler connection string or paste the
files into the SQL editor in order.

`public.usage_counters` + `consume_usage(key, amount, limit, window)` is the shared rate-limit
primitive: it increments and windows atomically in one statement, so limits are correct even with
many serverless instances.

## Supabase setup (production)

1. **PostgreSQL** — create a project, then copy _Project Settings → Database → Connection
   string_. Use the **session pooler** URL for serverless deployments. Apply the migrations.
2. **Storage** — the `..._storage.sql` migration creates a private bucket named `share-files`
   (configurable with `SUPABASE_STORAGE_BUCKET`) and a deny-all policy for client roles. All
   object access happens server-side with the service role, so no client policies are needed.
3. **Auth (optional)** — copy the project URL and anon key into `NEXT_PUBLIC_SUPABASE_URL` /
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Email/password sign-in works out of the box; the
   `profiles` table is populated by a trigger on `auth.users`.
4. **Service role** — set `SUPABASE_SERVICE_ROLE_KEY` (server-only). It bypasses RLS, which is
   why it never leaves the server: `lib/supabase/*` modules are marked `server-only`.
5. **Health check** — `GET /api/health` confirms which pieces are live. Auth being disabled is
   reported, not faked.

## Architecture

```
app/                     Next.js App Router
  api/                   Route handlers (the only public API surface)
  new/                   Share builder (/new)
  s/[shareId]/           Public viewer with gate screens and previews
  manage/[shareId]/      Builder for an existing collection (server-authorized)
  dashboard/             Collections owned by the current actor (guest or account)
  login/                 Supabase Auth sign-in/sign-up + server actions
  layout.tsx, page.tsx   App shell and marketing page
components/              UI (shadcn/Radix primitives in components/ui)
  auth/                  Credential form (useActionState)
  builder/               Builder panels: details, sidebar, editor, link, QR, settings
  dashboard/             Per-row actions (copy/open/manage/revoke/delete)
  viewer/                Gate screens, viewer shell, file previews
  code-editor.tsx        CodeMirror 6 wrapper with language extensions
lib/
  api/                   Browser-side typed API client (no server-only imports)
  auth/                  Actor resolution (user | guest | anonymous)
  config/                Lazy, validated server configuration and limits
  db/                    postgres.js client, row mappers, repositories (SQL only)
  downloads/             ZIP entry planning and streaming builder
  format.ts              Deterministic byte/date formatting (shared server/client)
  http/                  Request parsing (Zod), client identity, safe JSON responses
  permissions/           Pure authorization evaluation (unit tested, no I/O)
  rate-limit/            Limit specs and quota enforcement on top of consume_usage
  repositories...        Data access only — no HTTP, no business rules
  security/              IDs, digests, cookies, expiry, bcrypt, filename handling
  services/              Application layer: share lifecycle, items, uploads, previews, cleanup
  storage/               Storage driver interface + local and Supabase implementations
  uploads/               Magic-byte sniffing + browser upload transport (proxy/direct)
  validation/            Zod schemas shared by client forms and server handlers
supabase/migrations/     SQL schema, functions, RLS, storage
tests/                   Unit and integration suites (real PostgreSQL, real filesystem)
tests/e2e/               Playwright browser flows (real server + database)
docs/deployment.md       Step-by-step deployment runbook
proxy.ts                 Supabase session refresh (Next.js proxy, not middleware)
```

Rules the code follows:

- **One direction of dependency:** route → service → repository → SQL. Repositories never know
  about HTTP; services never trust a caller; routes never improvise SQL.
- **Authorization is a service-layer decision.** The UI may hide buttons, but `canManageShare`,
  `evaluateAccess`, and their callers decide. Item and byte limits are enforced server-side.
- **Secrets never leave the server.** `types/index.ts` defines the public API shapes; password
  hashes, token hashes, storage keys, and bucket credentials are not part of them.
- **Anything user-visible must come from the database.** No mock data, no seeded demo shares.

## Data model

| Table                 | Purpose                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `profiles`            | Display name/avatar for an `auth.users` row (created by trigger)                                                                           |
| `shares`              | A collection: title, description, visibility, expiry, revocation, password hash, download/edit flags, owner (user **or** guest token hash) |
| `share_items`         | Ordered items: `code`, `text`, or `file` (storage key, MIME type, size, filename)                                                          |
| `share_access_grants` | Revocable password grants (SHA-256 hash of the secret, bound to one share)                                                                 |
| `upload_reservations` | In-flight direct uploads with declared size and expiry                                                                                     |
| `usage_counters`      | Atomic rate-limit/quota windows shared by all instances                                                                                    |
| `share_view_daily`    | Coarse per-day view counts (no IPs, no user agents)                                                                                        |

`owner_id` and `guest_owner_token_hash` are mutually exclusive by constraint — every share has
exactly one kind of owner, which makes "who may manage this" unambiguous.

## HTTP API

All routes are `Cache-Control: no-store`. Success responses return the resource under a named key
(`{ share }`, `{ items }`, `{ item }`, `{ preview }`, …); failures return
`{ error: { code, message, details? } }` with a stable `code` (`validation_error`, `unauthorized`,
`forbidden`, `not_found`, `expired`, `revoked`, `password_required`, `rate_limited`,
`payload_too_large`, `quota_exceeded`, …). `/api/health` returns its own flat status document.

| Method             | Route                                          | Purpose                                     |
| ------------------ | ---------------------------------------------- | ------------------------------------------- |
| `POST`             | `/api/shares`                                  | Create a collection (guest cookie issued)   |
| `GET`              | `/api/shares/[shareId]`                        | Resolve a share + gate state                |
| `PATCH`            | `/api/shares/[shareId]`                        | Update settings, set/clear password         |
| `DELETE`           | `/api/shares/[shareId]`                        | Delete a collection and its objects         |
| `POST`             | `/api/shares/[shareId]/revoke`                 | Revoke the link (grants invalidated)        |
| `GET`              | `/api/shares/[shareId]/access`                 | Access state for the current caller         |
| `POST`             | `/api/shares/[shareId]/password`               | Verify password, issue a grant cookie       |
| `GET/POST/PUT`     | `/api/shares/[shareId]/items`                  | List / create / reorder items               |
| `GET/PATCH/DELETE` | `/api/shares/[shareId]/items/[itemId]`         | Read / edit / delete one item               |
| `GET`              | `/api/shares/[shareId]/items/[itemId]/preview` | Safe preview payload                        |
| `GET`              | `/api/shares/[shareId]/items/[itemId]/content` | Authorized bytes (inline or attachment)     |
| `POST`             | `/api/shares/[shareId]/upload`                 | Upload: multipart (proxy) or JSON (reserve) |
| `POST/DELETE`      | `/api/shares/[shareId]/upload/[reservationId]` | Confirm / abort a reserved upload           |
| `GET`              | `/api/shares/[shareId]/download-all`           | Streamed ZIP export                         |
| `GET`              | `/api/dashboard`                               | Paged list of the caller's collections      |
| `GET`              | `/api/health`                                  | Configuration and dependency status         |
| `GET/POST`         | `/api/cron/maintenance`                        | Cleanup job (Bearer `CRON_SECRET`)          |

### Pages

| Route               | Purpose                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `/`                 | Marketing page with health/status links                                                        |
| `/new`              | Two-phase builder: details form, then the editing workspace                                    |
| `/manage/[shareId]` | Same workspace for an existing collection (server-authorized; not just "knows the URL")        |
| `/s/[shareId]`      | Public viewer: password gate, expired/revoked screens, item navigation, previews, ZIP download |
| `/dashboard`        | Collections owned by the current actor (guest cookie or account), with filters and actions     |
| `/login`            | Supabase Auth sign-in/sign-up, or an explicit "guest-only deployment" screen                   |

## Security model

| Threat                               | Mitigation                                                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Guessing share URLs                  | 128-bit random share IDs, 256-bit capability tokens                                                                                 |
| Token theft from the database        | Only SHA-256 hashes of guest/grant tokens are stored                                                                                |
| Stolen link after password change    | Grants are share-bound rows; changing/clearing the password revokes them                                                            |
| Password brute force                 | Rate limit per client + share, `failClosed` on counter errors, bcrypt verification                                                  |
| Malicious uploads (SVG/HTML/PHP/EXE) | Magic-byte sniffing, download-only classification for active content, `nosniff`, CSP                                                |
| Path traversal via filenames         | Server-generated storage keys (`shares/<uuid>/<item-uuid>/<slug>`), validated on read                                               |
| ZIP path traversal                   | Entry names sanitized and de-duplicated before archiving                                                                            |
| Stored XSS in markdown notes         | HTML disabled in markdown-it + allowlist sanitizer (no scripts, no `javascript:` URLs, forced `rel="noopener noreferrer nofollow"`) |
| CSV formula/decompression abuse      | Row/column/field caps, size caps, truncation reporting                                                                              |
| IDOR on items/objects                | Every item lookup is scoped by the resolved share and its access state                                                              |
| Cross-instance rate-limit bypass     | Counters live in PostgreSQL behind an atomic function, not in process memory                                                        |
| Secret leakage in logs/errors        | Public API types exclude secrets; errors carry codes, not internals                                                                 |
| Clickjacking / MIME sniffing         | `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, HSTS                                      |

Every response is unframeable except `/api/shares/[shareId]/items/[itemId]/content`, which
overrides the two framing headers to `SAMEORIGIN` / `frame-ancestors 'self'` so the viewer's PDF
preview can embed it. Nothing else may be framed, and the content endpoint is still fully
authorized per request.

Row Level Security is enabled on every table as defence in depth. Application queries run as the
database owner, so RLS is _not_ the primary control — the service layer is — but a misconfigured
client key cannot read other people's rows.

**Password gates apply to recipients, not to the share's manager.** The authenticated owner or the
holder of the guest capability cookie is already authorized by `canManageShare` (the same check
that allows PATCH, revoke and delete), so `evaluateAccess` lets them read without a password grant;
otherwise setting a password would lock the creator out of their own collection. Expiry and
revocation still win for everyone, including managers. The integration suite covers both sides:
the creator reads after enabling a password, while a different guest capability and anonymous
visitors still get `password_required`.

## Testing

```bash
npm test                  # everything (unit + integration)
npm run test:unit         # pure logic: permissions, schemas, security, previews, archive, sniffing
npm run test:integration  # route handlers against real PostgreSQL + real local storage
npm run e2e               # Playwright browser flows against a real Next.js server + database
```

The integration suite boots a **real PostgreSQL instance** (`embedded-postgres`), applies the
Supabase-like bootstrap plus all migrations, and exercises the actual route handlers:

- share lifecycle: create → add items → reorder → rename → delete, cross-owner isolation,
  guest dashboard, and "no secrets in responses" assertions;
- access control: password gate + rate limiting, manager access under a password (the creator is
  never locked out, other guests are), expiry (`410`), revocation + grant invalidation,
  upload sniffing (HTML/SVG never inline), markdown sanitization, CSV caps, disabled downloads,
  ZIP contents, cleanup/purge, health, validation errors, guest byte quota.

Integration tests are run serially and reset the database between tests; storage is written to
`.data/test/storage`.

The Playwright suite (`tests/e2e/`) drives a real Chromium browser against a real server and the
configured database. `playwright.config.ts` starts `next dev` on port 3200 by default; set
`PLAYWRIGHT_BASE_URL` to test an already-running server (for example the production build on
`http://127.0.0.1:3100`). It covers:

- create a collection, add a code item (CodeMirror typing + language select), a note, and a CSV
  upload through the proxied transport;
- set a password, find the collection on the guest dashboard, generate a QR code;
- open the link in a **fresh anonymous browser context**: password gate → unlock → code preview →
  CSV table → ZIP download;
- revoke from `/manage/[shareId]`, confirm the revoked screen for the visitor, delete, and confirm
  the 404;
- the guest-only deployment screens (`/login`, empty `/dashboard`).

## Scripts

| Script                      | What it does                                        |
| --------------------------- | --------------------------------------------------- |
| `npm run dev`               | Next.js dev server                                  |
| `npm run build`             | Production build (Turbopack)                        |
| `npm run start`             | Serve the production build                          |
| `npm run lint`              | ESLint (Next.js core-web-vitals + TypeScript rules) |
| `npm run typecheck`         | `next typegen` + `tsc --noEmit`                     |
| `npm run format` / `:check` | Prettier write / verify                             |
| `npm test`                  | Vitest (unit + integration)                         |
| `npm run e2e`               | Playwright browser flows                            |
| `npm run dev:db`            | Local embedded PostgreSQL (bootstrap + migrations)  |
| `npm run db:migrate`        | Apply migrations to `DATABASE_URL`                  |

## Deployment

The short version: provision Supabase (Postgres + private Storage bucket), apply the migrations, set
the environment variables for the build, deploy, and schedule the maintenance cron. The full
runbook — including a security checklist and troubleshooting table — lives in
[`docs/deployment.md`](./docs/deployment.md).

1. **Provision** a Supabase project (Postgres + Storage) and apply the migrations.
2. **Set environment variables** in the hosting platform, including for the build:
   `DATABASE_URL` (session pooler), `NEXT_PUBLIC_APP_URL`,
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `STORAGE_DRIVER=supabase`, `HASH_SALT`, `BCRYPT_COST=12`,
   `CRON_SECRET`.
3. **Deploy** (`vercel deploy` or connect the repository). Build command `next build`.
4. **Schedule maintenance**: `POST /api/cron/maintenance` with
   `Authorization: Bearer $CRON_SECRET` hourly or daily — it prunes expired grants,
   abandoned upload reservations, usage counters, and long-expired shares with their objects.
   (`vercel.json` contains a daily cron definition.)
5. **Verify** `GET /api/health` on the deployment: it must report `database.ok` and
   `storage.ok`. Auth is optional.

Notes:

- Serverless function bodies are capped (default ~4.5 MB on Vercel), which is why
  `MAX_PROXIED_UPLOAD_MB` defaults to 4 and larger files use reserved direct-to-storage uploads.
- `STORAGE_DRIVER=local` does not survive serverless deployments; use Supabase Storage there.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` or `DATABASE_URL` to the browser.

## Project status

| Phase | Scope                                                                                       | State                                           |
| ----- | ------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1     | Foundation: schema + RLS, service layer, API routes, app shell, tests                       | **Implemented and verified**                    |
| 2     | Share builder: details form, item sidebar, CodeMirror editor, uploads, settings, link panel | **Implemented and verified**                    |
| 3     | Viewer: share page, previews (markdown/CSV/code/image/PDF), ZIP UX                          | **Implemented and verified**                    |
| 4     | Share URLs: `/s/[shareId]`, copy, QR, open, revoke, delete                                  | **Implemented and verified**                    |
| 5     | Access controls UI: password gate, expiry, revoke, guest dashboard, `/manage/[shareId]`     | **Implemented and verified**                    |
| 6     | Accounts: Supabase Auth sign-in/up/out, `/login`, dashboard identity                        | Implemented — **needs a live Supabase project** |
| 7     | Hardening: Playwright e2e, deployment docs, dependency audit triage                         | **Implemented and verified**                    |

What verification actually produced (commands and results, not claims):

```bash
node scripts/db-migrate.mjs --reset --bootstrap   # migrations applied to a clean PostgreSQL
npx tsc --noEmit                                  # exit 0
npm run lint                                      # 0 problems
npm run format:check                              # clean
npx vitest run                                    # 121 tests passing (98 unit + 23 integration)
npm run build                                     # production build succeeded; every content route dynamic
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100 npx playwright test
                                                  # 2/2 browser tests passing against the PRODUCTION build:
                                                  #   create → code (CodeMirror typing) → note → CSV upload →
                                                  #   password → dashboard → QR → anonymous gate → unlock →
                                                  #   code + CSV previews → ZIP download → revoke →
                                                  #   revoked screen → delete → 404
# production server smoke tests (built app, real PostgreSQL, real local storage):
#   GET /api/health -> database.ok, storage.ok (local driver), auth disabled and reported
#   GET /s/<demo share> -> 200 with all item titles server-rendered
#   content endpoint -> X-Frame-Options: SAMEORIGIN + CSP frame-ancestors 'self' (pages stay DENY)
#   GET /api/shares/<id>/download-all -> application/zip, attachment, PK magic bytes
#   GET /s/does-not-exist -> 404
#   npm audit --omit=dev -> 0 vulnerabilities (advisories remain in the shadcn CLI dev toolchain)
```

The 3-minute local loop to reproduce the browser test yourself:

```bash
npm run dev:db                       # terminal 1: local PostgreSQL
npm run e2e                          # terminal 2: Playwright starts its own Next.js server
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 npx playwright test   # or test a running server
```

## Known limitations

Stated plainly so nothing is mistaken for finished work:

- **Supabase Auth is not configured on the live deployment** (it runs guest-only; `/login` says so),
  so sign-up, sign-in, and account-claim flows are exercised structurally only. Supabase
  **Storage** is verified live end-to-end: private-bucket uploads through the server, inline
  preview streaming, file downloads, and ZIP exports all read from Supabase Storage. Direct-to-storage
  browser uploads (files above `MAX_PROXIED_UPLOAD_MB`, 4 MB by default) additionally need
  `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`; without them the UI reports a
  precise error and the proxy path keeps working for smaller files.
- Row Level Security is enabled and policy-verified by SQL assertions, but the application
  connects as the database owner; RLS is defence in depth, not the primary control.
- The browser suite runs in **Chromium only**, and there is no automated accessibility audit yet
  (the UI uses semantic roles and labels, but that has not been machine-verified).
- `npm audit --omit=dev` reports **0 vulnerabilities**; the remaining advisories are all in the
  `shadcn` CLI / ESLint dev toolchain (a `braces` DoS via `fast-glob`/`micromatch`). No
  non-breaking fix exists, and none of it ships to the server or the browser.
- Email delivery, password reset, guest→account claiming, and account deletion flows are not
  implemented.
- The viewer records a per-day view count per share; there is no analytics dashboard, and repeat
  views in the same render pass are counted once.
- Local filesystem storage is single-instance only and is not a production storage backend.
- PDF preview depends on the browser's built-in viewer. Preview bytes are relayed same-origin by the
  content endpoint (the only frameable response), so storage URLs are never framed directly.

## License

Unlicensed / private. Add a license before publishing.
