-- CodeShare Plus :: 0002 functions and triggers

-- ------------------------------------------------------------------ updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists shares_set_updated_at on public.shares;
create trigger shares_set_updated_at
  before update on public.shares
  for each row execute function public.set_updated_at();

drop trigger if exists share_items_set_updated_at on public.share_items;
create trigger share_items_set_updated_at
  before update on public.share_items
  for each row execute function public.set_updated_at();

-- Touch the parent share whenever its items change (drives "recently updated").
create or replace function public.touch_share_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.shares
     set updated_at = now()
   where id = coalesce(new.share_uuid, old.share_uuid);
  return null;
end;
$$;

drop trigger if exists share_items_touch_share on public.share_items;
create trigger share_items_touch_share
  after insert or update or delete on public.share_items
  for each row execute function public.touch_share_updated_at();

-- -------------------------------------------------------------- usage counters
-- Atomically consume `p_amount` from a fixed window bucket.
-- Returns whether the caller is still within the limit, the remaining budget and
-- when the window resets. Used for rate limiting and byte quotas.
create or replace function public.consume_usage(
  p_key text,
  p_amount bigint,
  p_limit bigint,
  p_window_seconds integer
)
returns table (allowed boolean, remaining bigint, reset_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_counter bigint;
  v_window_started timestamptz;
begin
  if p_amount < 0 then
    raise exception 'p_amount must be >= 0';
  end if;
  if p_limit < 0 then
    raise exception 'p_limit must be >= 0';
  end if;

  insert into public.usage_counters as uc (bucket_key, window_started_at, window_seconds, counter, updated_at)
  values (p_key, v_now, p_window_seconds, p_amount, v_now)
  on conflict (bucket_key) do update
    set counter = case
          when uc.window_started_at + make_interval(secs => uc.window_seconds) <= v_now then p_amount
          else uc.counter + p_amount
        end,
        window_started_at = case
          when uc.window_started_at + make_interval(secs => uc.window_seconds) <= v_now then v_now
          else uc.window_started_at
        end,
        window_seconds = case
          when uc.window_started_at + make_interval(secs => uc.window_seconds) <= v_now then p_window_seconds
          else uc.window_seconds
        end,
        updated_at = v_now
  returning uc.counter, uc.window_started_at into v_counter, v_window_started;

  allowed := v_counter <= p_limit;
  remaining := greatest(p_limit - v_counter, 0);
  reset_at := v_window_started + make_interval(secs => p_window_seconds);
  return next;
end;
$$;

comment on function public.consume_usage(text, bigint, bigint, integer) is
  'Atomic fixed-window counter. Server-only: execute is revoked from public/anon/authenticated.';

revoke all on function public.consume_usage(text, bigint, bigint, integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.consume_usage(text, bigint, bigint, integer) to service_role';
  end if;
end;
$$;

-- Check a window without consuming (used for availability checks/tests).
create or replace function public.peek_usage(
  p_key text
)
returns table (counter bigint, window_started_at timestamptz, window_seconds integer)
language sql
security definer
set search_path = public, pg_temp
as $$
  select uc.counter, uc.window_started_at, uc.window_seconds
    from public.usage_counters uc
   where uc.bucket_key = p_key;
$$;

revoke all on function public.peek_usage(text) from public;

create or replace function public.prune_usage_counters(p_older_than interval default '2 days')
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from public.usage_counters where updated_at < now() - p_older_than;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_usage_counters(interval) from public;

-- Non-consuming availability check used by the upload flow before a reservation.
create or replace function public.usage_available(
  p_key text,
  p_amount bigint,
  p_limit bigint
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select case
       when uc.window_started_at + make_interval(secs => uc.window_seconds) <= now() then true
       else uc.counter + p_amount <= p_limit
     end
     from public.usage_counters uc
     where uc.bucket_key = p_key),
    true
  );
$$;

revoke all on function public.usage_available(text, bigint, bigint) from public;

-- ----------------------------------------------------------------- profiles
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'avatar_url', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
