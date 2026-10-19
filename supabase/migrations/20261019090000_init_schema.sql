-- CodeShare Plus :: 0001 core schema
-- Tables, constraints and indexes.
--
-- Design notes:
--   * `shares.id` is an internal UUID; `shares.share_id` is the public,
--     unguessable URL identifier. Neither is an authorization mechanism.
--   * `guest_owner_token_hash` stores SHA-256 of a 256-bit capability token.
--     Plaintext capability tokens exist only in the guest's HttpOnly cookie.
--   * `password_hash` stores bcrypt hashes; never plaintext passwords.
--   * Positions are unique per share (deferrable, so reordering is a single
--     transaction).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- profiles --
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  constraint profiles_display_name_length check (display_name is null or length(display_name) between 1 and 80),
  constraint profiles_avatar_url_length check (avatar_url is null or length(avatar_url) <= 2048)
);

comment on table public.profiles is 'Public profile data for authenticated users. Owner-read/write via RLS.';

-- ------------------------------------------------------------------ shares --
create table if not exists public.shares (
  id uuid primary key default gen_random_uuid(),
  share_id text not null,
  owner_id uuid references auth.users (id) on delete set null,
  guest_owner_token_hash text,
  title text not null,
  description text,
  visibility text not null default 'unlisted',
  password_hash text,
  expires_at timestamptz,
  allow_download boolean not null default true,
  allow_edit boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint shares_share_id_unique unique (share_id),
  constraint shares_share_id_format check (share_id ~ '^[A-Za-z0-9_-]{16,64}$'),
  constraint shares_title_length check (length(title) between 1 and 200),
  constraint shares_description_length check (description is null or length(description) <= 5000),
  constraint shares_visibility_values check (visibility in ('public', 'unlisted')),
  constraint shares_ownership check (owner_id is not null or guest_owner_token_hash is not null),
  constraint shares_guest_hash_format check (guest_owner_token_hash is null or guest_owner_token_hash ~ '^[0-9a-f]{64}$'),
  constraint shares_password_hash_format check (password_hash is null or password_hash ~ '^\$2[aby]\$')
);

comment on table public.shares is
  'A shareable collection. Every share has either an authenticated owner (owner_id) or a guest management capability (guest_owner_token_hash).';
comment on column public.shares.share_id is 'Public unguessable locator used in /s/<share_id>. Not an authorization secret.';
comment on column public.shares.guest_owner_token_hash is 'SHA-256 of the guest management token. The plaintext token lives only in the guest HttpOnly cookie.';
comment on column public.shares.allow_edit is 'Marks a share as collaborative. Does NOT grant edit rights to anonymous link recipients.';

create index if not exists shares_owner_idx on public.shares (owner_id, created_at desc) where owner_id is not null;
create index if not exists shares_guest_hash_idx on public.shares (guest_owner_token_hash) where guest_owner_token_hash is not null;
create index if not exists shares_expires_idx on public.shares (expires_at) where expires_at is not null and revoked_at is null;
create index if not exists shares_public_idx on public.shares (created_at desc) where visibility = 'public' and revoked_at is null;

-- ------------------------------------------------------------- share_items --
create table if not exists public.share_items (
  id uuid primary key default gen_random_uuid(),
  share_uuid uuid not null references public.shares (id) on delete cascade,
  item_type text not null,
  title text not null,
  content text,
  language text,
  storage_key text,
  original_filename text,
  mime_type text,
  size_bytes bigint,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint share_items_type_values check (item_type in ('code', 'text', 'file')),
  constraint share_items_title_length check (length(title) between 1 and 200),
  constraint share_items_position_positive check (position >= 0),
  constraint share_items_position_unique unique (share_uuid, position) deferrable initially deferred,
  -- file items: must reference a stored object with complete metadata
  constraint share_items_file_fields check (
    item_type <> 'file'
    or (
      storage_key is not null
      and original_filename is not null
      and size_bytes is not null
      and size_bytes >= 0
      and content is null
      and language is null
    )
  ),
  -- non-file items: must not carry storage references
  constraint share_items_non_file_fields check (
    item_type = 'file'
    or (storage_key is null and original_filename is null and size_bytes is null and mime_type is null)
  ),
  -- code/text items must have content
  constraint share_items_content_required check (item_type = 'file' or content is not null),
  -- language is meaningful for code items only
  constraint share_items_language_scope check (item_type = 'code' or language is null),
  constraint share_items_storage_key_format check (
    storage_key is null or storage_key ~ '^shares/[0-9a-f-]{36}/(uploads/)?[0-9a-f-]{36}/[A-Za-z0-9._-]+$'
  ),
  constraint share_items_mime_length check (mime_type is null or length(mime_type) <= 255),
  constraint share_items_filename_length check (original_filename is null or length(original_filename) <= 255),
  constraint share_items_language_length check (language is null or length(language) <= 32)
);

comment on table public.share_items is 'Items of a share: code snippets, text notes or file references (storage objects).';
comment on column public.share_items.storage_key is 'Server-generated private storage object key. Never exposed to unauthorized clients.';

create index if not exists share_items_share_position_idx on public.share_items (share_uuid, position);

-- ----------------------------------------------------- share_access_grants --
create table if not exists public.share_access_grants (
  id uuid primary key default gen_random_uuid(),
  share_uuid uuid not null references public.shares (id) on delete cascade,
  grant_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz,
  constraint share_access_grants_hash_format check (grant_hash ~ '^[0-9a-f]{64}$'),
  constraint share_access_grants_hash_unique unique (grant_hash)
);

comment on table public.share_access_grants is
  'Server-only. Password access grants bound to a single share. Stores SHA-256 of the grant secret; revocable.';

create index if not exists share_access_grants_share_idx on public.share_access_grants (share_uuid) where revoked_at is null;
create index if not exists share_access_grants_expiry_idx on public.share_access_grants (expires_at) where revoked_at is null;

-- ------------------------------------------------------- upload_reservations --
create table if not exists public.upload_reservations (
  id uuid primary key default gen_random_uuid(),
  share_uuid uuid not null references public.shares (id) on delete cascade,
  storage_key text not null unique,
  original_filename text not null,
  declared_mime text,
  declared_size bigint not null,
  status text not null default 'pending',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  constraint upload_reservations_status_values check (status in ('pending', 'completed', 'aborted', 'expired')),
  constraint upload_reservations_declared_size check (declared_size > 0),
  constraint upload_reservations_storage_key_format check (
    storage_key ~ '^shares/[0-9a-f-]{36}/uploads/[0-9a-f-]{36}/[A-Za-z0-9._-]+$'
  ),
  constraint upload_reservations_filename_length check (length(original_filename) between 1 and 255),
  constraint upload_reservations_mime_length check (declared_mime is null or length(declared_mime) <= 255)
);

comment on table public.upload_reservations is
  'Server-only. Tracks direct-to-storage upload reservations so abandoned uploads can be cleaned up.';

create index if not exists upload_reservations_pending_idx on public.upload_reservations (expires_at) where status = 'pending';

-- ---------------------------------------------------------- usage_counters --
create table if not exists public.usage_counters (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  window_seconds integer not null,
  counter bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint usage_counters_window_seconds_range check (window_seconds between 1 and 2678400),
  constraint usage_counters_counter_non_negative check (counter >= 0)
);

comment on table public.usage_counters is
  'Server-only. Persistent, shared rate-limit and quota counters (counts and byte totals). Keys are salted hashes; prune via prune_usage_counters().';

create index if not exists usage_counters_updated_idx on public.usage_counters (updated_at);

-- -------------------------------------------------------- share_view_daily --
create table if not exists public.share_view_daily (
  share_uuid uuid not null references public.shares (id) on delete cascade,
  day date not null,
  views bigint not null default 0,
  constraint share_view_daily_views_non_negative check (views >= 0),
  unique (share_uuid, day)
);

comment on table public.share_view_daily is
  'Server-only, privacy-conscious analytics: daily aggregate view counts. No IP addresses, user agents or individual view events are stored.';
