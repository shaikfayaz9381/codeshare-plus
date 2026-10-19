import "server-only";
import { db } from "@/lib/db/client";
import type { ProfileRow } from "@/lib/db/rows";

/** Data-access layer for `profiles`. */

export async function getProfile(userId: string): Promise<ProfileRow | null> {
  const rows = await db()<ProfileRow[]>`select * from public.profiles where id = ${userId} limit 1`;
  return rows[0] ?? null;
}

export async function upsertProfile(
  userId: string,
  input: { displayName?: string | null; avatarUrl?: string | null },
): Promise<ProfileRow> {
  const rows = await db()<ProfileRow[]>`
    insert into public.profiles (id, display_name, avatar_url)
    values (${userId}, ${input.displayName ?? null}, ${input.avatarUrl ?? null})
    on conflict (id) do update
      set display_name = coalesce(excluded.display_name, public.profiles.display_name),
          avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url)
    returning *
  `;
  const row = rows[0];
  if (!row) throw new Error("profile upsert returned no row");
  return row;
}
