-- CodeShare Plus :: local/test bootstrap (NOT a Supabase migration)
--
-- A real Supabase project already provides the `auth` schema, the `storage`
-- schema and the `anon` / `authenticated` / `service_role` database roles.
-- This script recreates minimal equivalents so that the *same* migrations can
-- be applied to a plain PostgreSQL instance for local development, automated
-- integration tests and RLS policy verification.
--
-- Do not run this against a managed Supabase database.

-- ------------------------------------------------------------------- roles --
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

grant usage on schema public to anon, authenticated, service_role;

-- -------------------------------------------------------------------- auth --
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Equivalent of Supabase's auth.uid(): reads the JWT `sub` claim from the
-- session variable set by PostgREST / tests.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select case
    when nullif(current_setting('request.jwt.claims', true), '') is null then null
    else nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'sub', '')::uuid
  end;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select case
    when nullif(current_setting('request.jwt.claims', true), '') is null then null
    else (nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'role'
  end;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;

-- ----------------------------------------------------------------- storage --
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  public boolean not null default false,
  avif_autodetection boolean,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  version text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

grant usage on schema storage to anon, authenticated, service_role;
