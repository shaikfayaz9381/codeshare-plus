"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2Icon, LogInIcon, UserPlusIcon } from "lucide-react";

import { signInAction, signUpAction } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Credential form for both sign-in and sign-up. Validation is repeated
 * server-side in the action; this browser-side `required`/`minLength` markup is
 * only a convenience.
 */

export interface LoginFormProps {
  mode: "signin" | "signup";
  next: string;
}

export function LoginForm({ mode, next }: LoginFormProps) {
  const action = mode === "signup" ? signUpAction : signInAction;
  const [state, formAction, pending] = React.useActionState(action, {});

  const switchHref =
    mode === "signup"
      ? `/login?next=${encodeURIComponent(next)}`
      : `/login?mode=signup&next=${encodeURIComponent(next)}`;

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl">
          {mode === "signup" ? "Create an account" : "Welcome back"}
        </CardTitle>
        <CardDescription>
          {mode === "signup"
            ? "Keep your collections across devices and manage them from one dashboard."
            : "Sign in to see the collections tied to your account."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="next" value={next} />

          {mode === "signup" ? (
            <div className="space-y-2">
              <Label htmlFor="displayName">Display name (optional)</Label>
              <Input
                id="displayName"
                name="displayName"
                autoComplete="name"
                maxLength={80}
                placeholder="Ada Lovelace"
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              minLength={8}
              maxLength={128}
              placeholder="At least 8 characters"
            />
          </div>

          {state.error ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-sm"
            >
              {state.error}
            </p>
          ) : null}
          {state.message ? (
            <p
              role="status"
              className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-sm"
            >
              {state.message}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? (
              <Loader2Icon className="animate-spin" aria-hidden="true" />
            ) : mode === "signup" ? (
              <UserPlusIcon aria-hidden="true" />
            ) : (
              <LogInIcon aria-hidden="true" />
            )}
            {mode === "signup" ? "Create account" : "Sign in"}
          </Button>
        </form>

        <div className="space-y-2 border-t pt-4 text-sm text-muted-foreground">
          <p>
            {mode === "signup" ? "Already have an account?" : "New to CodeShare Plus?"}{" "}
            <Link
              href={switchHref}
              className="font-medium text-foreground underline underline-offset-2"
            >
              {mode === "signup" ? "Sign in" : "Create an account"}
            </Link>
          </p>
          <p>
            No account needed.{" "}
            <Link href="/new" className="font-medium text-foreground underline underline-offset-2">
              Create a guest collection
            </Link>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
