-- CodeShare Plus :: 0004 storage bucket and policies
--
-- Private bucket for uploaded files. Objects are only reachable through:
--   * server-side authorized proxy endpoints (signed short-lived reads), or
--   * signed upload URLs issued by the server for direct-to-storage uploads.
-- Clients (anon/authenticated) have no storage.objects privileges on this
-- bucket; the service role bypasses RLS for server operations.

insert into storage.buckets (id, name, public, file_size_limit)
values ('share-files', 'share-files', false, 104857600)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

drop policy if exists "share-files deny client access" on storage.objects;
create policy "share-files deny client access" on storage.objects
  for all to anon, authenticated
  using (bucket_id = 'share-files' and false)
  with check (bucket_id = 'share-files' and false);
