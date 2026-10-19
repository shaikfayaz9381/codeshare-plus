-- ---------------------------------------------------------------------------
-- Custom share links (e.g. /s/my-team-notes)
--
-- The original format check only accepted the random 22-character identifiers
-- (16-64 base64url characters). Creator-chosen links are shorter, lowercase,
-- and may contain hyphens, so the constraint now accepts either shape:
--
--   * generated : 16-64 base64url characters (existing rows untouched)
--   * custom    : 4-32 lowercase alphanumerics/hyphens, alphanumeric ends
--                 (mirrors customShareIdSchema in lib/validation/schemas.ts)
--
-- Uniqueness is unchanged: shares_share_id_unique still guarantees that a
-- custom link can never shadow an existing one.
-- ---------------------------------------------------------------------------

alter table public.shares drop constraint if exists shares_share_id_format;

alter table public.shares
  add constraint shares_share_id_format check (
    share_id ~ '^[A-Za-z0-9_-]{16,64}$'
    or share_id ~ '^[a-z0-9](?:[a-z0-9-]{2,30}[a-z0-9])$'
  );
