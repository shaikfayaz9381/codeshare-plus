"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Account Server Actions.
 *
 * Authentication is delegated entirely to Supabase Auth: credentials are never
 * stored or verified by this application, and the resulting session lives in
 * HttpOnly cookies managed by `@supabase/ssr`. `proxy.ts` refreshes those
 * cookies on navigation; `lib/auth/actor.ts` re-validates the session on every
 * request.
 *
 * These flows require a configured Supabase project. Without one the actions
 * fail closed with an explanatory message (the UI also says so up front).
 */

export interface AuthFormState {
  error?: string;
  message?: string;
}

const credentialsSchema = z.object({
  email: z.email().max(254),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(128, "Password is too long."),
});

const signUpSchema = credentialsSchema.extend({
  displayName: z.string().trim().max(80).optional(),
});

/** Only same-origin absolute paths are accepted as a post-login destination. */
function safeNext(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/dashboard";
  }
  return value;
}

export async function signInAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Enter a valid email address and a password of at least 8 characters." };
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return {
      error:
        "Accounts are not configured on this deployment. Guest collections work without an account.",
    };
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email.trim().toLowerCase(),
    password: parsed.data.password,
  });
  if (error) {
    return { error: error.message };
  }

  redirect(safeNext(formData.get("next")));
}

export async function signUpAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    displayName: formData.get("displayName") || undefined,
  });
  if (!parsed.success) {
    return { error: "Enter a valid email address and a password of at least 8 characters." };
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return {
      error:
        "Accounts are not configured on this deployment. Guest collections work without an account.",
    };
  }

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email.trim().toLowerCase(),
    password: parsed.data.password,
    options: {
      data: parsed.data.displayName ? { display_name: parsed.data.displayName } : undefined,
    },
  });
  if (error) {
    return { error: error.message };
  }

  if (!data.session) {
    return {
      message:
        "Account created. Check your inbox to confirm your email address, then sign in. " +
        "Email delivery depends on your Supabase project's SMTP settings.",
    };
  }

  redirect(safeNext(formData.get("next")));
}

export async function signOutAction(): Promise<void> {
  const supabase = await getServerSupabase();
  if (supabase) {
    await supabase.auth.signOut();
  }
  redirect("/");
}
