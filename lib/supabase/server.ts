import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase server client for Server Components, Server Actions and Route
 * Handlers. Reads the session from cookies; `setAll` is a no-op in Server
 * Components (refresh happens in proxy.ts) and persists cookies elsewhere.
 *
 * Returns null when Supabase is not configured so the application can run
 * guest-only (clearly reported by /api/health, never faked).
 */

export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export async function getServerSupabase(): Promise<SupabaseClient | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  // Imported lazily: `next/headers` is only available inside a Next.js request
  // context (this module is also imported by tests and scripts).
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render: cookies are read-only.
          // proxy.ts performs the refresh write in that case.
        }
      },
    },
  });
}

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  displayName: string | null;
}

/**
 * Verified current user (validated against Supabase Auth). Never trust a
 * client-supplied user id; this is the only source of account identity.
 */
export async function getSupabaseUser(): Promise<AuthenticatedUser | null> {
  const supabase = await getServerSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
    const displayName =
      typeof meta.display_name === "string" && meta.display_name.trim() !== ""
        ? meta.display_name.trim()
        : null;
    return { id: data.user.id, email: data.user.email ?? null, displayName };
  } catch {
    return null;
  }
}
