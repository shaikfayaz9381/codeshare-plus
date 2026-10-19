-- CodeShare Plus :: 0003 row level security
--
-- The application performs all data access through a privileged server-side
-- connection (DATABASE_URL). RLS is defence in depth for any direct/PostgREST
-- access with the anon or authenticated role:
--   * anon      -> may read public, unprotected, unexpired, unrevoked shares
--   * authenticated -> may additionally read and manage their own shares
--   * server-only tables (grants, reservations, counters, analytics) have RLS
--     enabled with no policies, i.e. default deny for client roles.

alter table public.profiles enable row level security;
alter table public.shares enable row level security;
alter table public.share_items enable row level security;
alter table public.share_access_grants enable row level security;
alter table public.upload_reservations enable row level security;
alter table public.usage_counters enable row level security;
alter table public.share_view_daily enable row level security;

-- --------------------------------------------------------------- privileges --
-- Explicit grants keep PostgREST access least-privilege. The server-side
-- connection uses a privileged role and is unaffected by these grants.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select, insert, update, delete on public.profiles to authenticated';
    execute 'grant select, insert, update, delete on public.shares to authenticated';
    execute 'grant select, insert, update, delete on public.share_items to authenticated';
    execute 'revoke all on public.share_access_grants from authenticated';
    execute 'revoke all on public.upload_reservations from authenticated';
    execute 'revoke all on public.usage_counters from authenticated';
    execute 'revoke all on public.share_view_daily from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant select on public.shares to anon';
    execute 'grant select on public.share_items to anon';
    execute 'revoke all on public.profiles from anon';
    execute 'revoke all on public.share_access_grants from anon';
    execute 'revoke all on public.upload_reservations from anon';
    execute 'revoke all on public.usage_counters from anon';
    execute 'revoke all on public.share_view_daily from anon';
  end if;
end;
$$;

-- ----------------------------------------------------------------- profiles --
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ------------------------------------------------------------------- shares --
drop policy if exists shares_select_own on public.shares;
create policy shares_select_own on public.shares
  for select to authenticated
  using (owner_id = auth.uid());

-- Public shares are readable without a password, while valid and not revoked.
-- Password-protected shares are not directly readable: password verification
-- and access grants are issued by the server only.
drop policy if exists shares_select_public_unprotected on public.shares;
create policy shares_select_public_unprotected on public.shares
  for select to anon, authenticated
  using (
    visibility = 'public'
    and revoked_at is null
    and password_hash is null
    and (expires_at is null or expires_at > now())
  );

-- Authenticated users may create shares they own. Guest shares (with a guest
-- capability token) are created exclusively by trusted server code.
drop policy if exists shares_insert_own on public.shares;
create policy shares_insert_own on public.shares
  for insert to authenticated
  with check (owner_id = auth.uid() and guest_owner_token_hash is null);

drop policy if exists shares_update_own on public.shares;
create policy shares_update_own on public.shares
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists shares_delete_own on public.shares;
create policy shares_delete_own on public.shares
  for delete to authenticated
  using (owner_id = auth.uid());

-- -------------------------------------------------------------- share_items --
drop policy if exists share_items_select_owner on public.share_items;
create policy share_items_select_owner on public.share_items
  for select to authenticated
  using (
    exists (
      select 1 from public.shares s
      where s.id = share_uuid and s.owner_id = auth.uid()
    )
  );

drop policy if exists share_items_select_public on public.share_items;
create policy share_items_select_public on public.share_items
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.shares s
      where s.id = share_uuid
        and s.visibility = 'public'
        and s.revoked_at is null
        and s.password_hash is null
        and (s.expires_at is null or s.expires_at > now())
    )
  );

drop policy if exists share_items_insert_owner on public.share_items;
create policy share_items_insert_owner on public.share_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.shares s
      where s.id = share_uuid and s.owner_id = auth.uid()
    )
  );

drop policy if exists share_items_update_owner on public.share_items;
create policy share_items_update_owner on public.share_items
  for update to authenticated
  using (
    exists (
      select 1 from public.shares s
      where s.id = share_uuid and s.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.shares s
      where s.id = share_uuid and s.owner_id = auth.uid()
    )
  );

drop policy if exists share_items_delete_owner on public.share_items;
create policy share_items_delete_owner on public.share_items
  for delete to authenticated
  using (
    exists (
      select 1 from public.shares s
      where s.id = share_uuid and s.owner_id = auth.uid()
    )
  );

-- Server-only tables -----------------------------------------------------------------
-- share_access_grants, upload_reservations, usage_counters and share_view_daily
-- have RLS enabled with no policies -> no anon/authenticated access at all.
-- Only the privileged server-side connection (and service_role) can read/write
-- these tables.
