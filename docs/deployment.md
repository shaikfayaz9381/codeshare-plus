# Deploying CodeShare Plus

The application is a standard Next.js 16 app. It needs two things at runtime:

1. **PostgreSQL** — all application data (Supabase Postgres is the intended host).
2. **Object storage** — file bytes live in a private Supabase Storage bucket, or on the local
   filesystem for single-instance/self-hosted deployments.

Accounts (Supabase Auth) are optional. Without them the app runs in guest-only mode and says so
on `/login` and `/api/health`.

---

## 1. Provision Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. **Database** — _Project Settings → Database → Connection string_. Use the **session pooler**
   (port `5432`) or the transaction pooler (port `6543`) for serverless hosts. The app uses a
   single `postgres.js` client per instance and does not rely on prepared statements, so both work.
3. **Storage** — nothing to create by hand: the `..._storage.sql` migration creates the private
   bucket (`share-files` by default) and a deny-by-default policy for client roles. All bytes are
   read/written server-side with the service role.
4. **Auth (optional)** — _Authentication → Providers_: enable Email. Copy the project URL and the
   **anon** key for the browser-facing variables. Configure SMTP if you want confirmation emails
   (Supabase's built-in SMTP is rate-limited).
5. Copy the **service role** key from _Project Settings → API_. It bypasses RLS; it must never be
   exposed to the browser.

## 2. Apply the migrations

Install dependencies on a machine with access to the database:

```bash
npm install
DATABASE_URL="<session-pooler-connection-string>" npm run db:migrate
```

`npm run db:migrate` applies `supabase/migrations/*.sql` in filename order and records versions in
`public.applied_migrations`. On a **plain** PostgreSQL (not Supabase) add `--bootstrap` once to
create the `auth`/`storage` schema stubs first:

```bash
node scripts/db-migrate.mjs --bootstrap
```

Alternatively paste the four SQL files into the Supabase SQL editor in order. They are idempotent.

## 3. Configure environment variables

Set these in the hosting platform **for the build environment as well as the runtime** — every
`NEXT_PUBLIC_*` value is inlined during `next build`.

| Variable                                                    | Required         | Notes                                                                 |
| ----------------------------------------------------------- | ---------------- | --------------------------------------------------------------------- |
| `DATABASE_URL`                                              | yes              | Pooler connection string                                              |
| `NEXT_PUBLIC_APP_URL`                                       | yes              | Canonical origin, e.g. `https://codeshare.example.com`; used in links |
| `STORAGE_DRIVER`                                            | yes              | `supabase` in production; `local` only for single-instance hosts      |
| `SUPABASE_SERVICE_ROLE_KEY`                                 | with `supabase`  | Server-only                                                           |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | optional         | Required for accounts (and for direct large uploads)                  |
| `HASH_SALT`                                                 | yes              | `openssl rand -hex 32` — salts rate-limit/analytics hashes            |
| `CRON_SECRET`                                               | yes              | Bearer secret for `/api/cron/maintenance`                             |
| `BCRYPT_COST`                                               | recommended `12` | 10–15 accepted                                                        |
| `SUPABASE_STORAGE_BUCKET`                                   | optional         | Defaults to `share-files`                                             |
| `MAX_*`, `RATE_LIMIT_*`, `MAX_PROXIED_UPLOAD_MB`            | optional         | See `.env.example` for defaults and ranges                            |

Full descriptions and defaults live in [`.env.example`](../.env.example).

## 4. Deploy

### Vercel

1. Import the repository.
2. Add the environment variables above for **Production** (and Preview if you use it).
3. Build command `next build` (default), output `.next` (default).
4. Deploy. `vercel.json` ships a daily cron entry for `/api/cron/maintenance` (adjust the schedule
   to taste; Vercel Hobby plan supports one run per day).

### Render

1. Create a **Web Service** from the repository.
   - Build command: `npm ci --include=dev && npm run build` (`--include=dev` is required when the
     service sets `NODE_ENV=production`, otherwise the build tools are skipped).
   - Start command: `npm run start` (`next start` honours `$PORT`).
   - Health check path: `/api/health`.
2. Add every variable from § 3 under **Environment** _before_ the first build —
   `NEXT_PUBLIC_*` values are inlined at build time. After changing them, use
   **Clear build cache & deploy**.
3. Apply the migrations (§ 2) from your machine; they work through the Supabase pooler.
4. Free instances sleep when idle, so the first request after a while takes a few seconds.

### Any Node host

```bash
npm ci
npm run build          # set the env vars first: NEXT_PUBLIC_* are inlined here
NODE_ENV=production npm run start -- --port 3000
```

Run behind TLS (the app sets HSTS and expects `https`). `STORAGE_DRIVER=local` keeps bytes under
`.data/storage`, so mount a persistent volume and run exactly one instance.

## 5. Post-deploy checks

```bash
curl -s https://<host>/api/health | jq
```

Expected on a fully configured deployment:

- `database.ok: true` (migrations applied);
- `storage.ok: true` with `driver: "supabase"`;
- `auth.enabled: true` only when the Supabase URL and anon key are set.

Then exercise the real thing: create a collection at `/new`, upload a file, open the link in a
private window, unlock it with the password, and download the ZIP. `npm run e2e` automates exactly
that flow against whatever `PLAYWRIGHT_BASE_URL` points at.

## 6. Maintenance

- **Cron** — `POST /api/cron/maintenance` with `Authorization: Bearer $CRON_SECRET` prunes expired
  grants, abandoned upload reservations, old usage counters, and long-expired shares (with their
  stored objects). Daily is fine; hourly if you set many short expiries.
- **Backups** — Supabase handles Postgres backups on paid tiers; storage durability depends on your
  plan. Guest capability tokens and password grant secrets are one-way hashes, so a leaked backup
  cannot be used to unlock shares.
- **Rotating secrets** — rotating `HASH_SALT` invalidates rate-limit counters (they simply reset).
  Rotating `CRON_SECRET` requires updating the caller. The service-role key can be rotated in
  Supabase and redeployed without data changes.

## 7. Security checklist

- [ ] `SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` are server-only (never `NEXT_PUBLIC_`).
- [ ] Migrations applied; `X-Frame-Options: DENY` present on pages (`curl -I`).
- [ ] `HASH_SALT` and `CRON_SECRET` are random, unique per environment.
- [ ] Storage bucket is private; direct uploads are only enabled when you accept the client-side
      anon key being public (it is designed to be).
- [ ] `MAX_PROXIED_UPLOAD_MB` fits your hosting provider's request-body limit
      (Vercel: ~4.5 MB; larger files use reserved direct uploads).
- [ ] TLS enforced end-to-end; HSTS is sent by the app.

## Troubleshooting

| Symptom                                              | Likely cause / fix                                                                                                                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Form fails with `Missing required configuration "…"` | The deploy has no environment variables. Set them in the host dashboard (Render: service -> Environment; Vercel: Project -> Settings -> Environment Variables), then redeploy. See § 3. |
| `/api/health` reports `database.ok: false`           | `DATABASE_URL` wrong, pooler paused, or migrations not applied                                                                                                                          |
| Uploads fail with `storage_not_configured`           | `STORAGE_DRIVER=supabase` without `SUPABASE_SERVICE_ROLE_KEY`, or bucket missing (re-run migrations)                                                                                    |
| Large uploads fail with a 413                        | Provider body cap; raise `MAX_PROXIED_UPLOAD_MB` only up to that cap — bigger files should use direct uploads (which need the Supabase URL + anon key)                                  |
| `/login` says "Guest-only deployment"                | `NEXT_PUBLIC_SUPABASE_URL` / `..._ANON_KEY` missing at build time (restart/rebuild after setting them)                                                                                  |
| Share links point at the wrong origin                | `NEXT_PUBLIC_APP_URL` was wrong at build time — rebuild with the production origin                                                                                                      |
| Local driver loses files after redeploy              | `local` storage is single-instance and not durable on serverless hosts; use Supabase Storage                                                                                            |
