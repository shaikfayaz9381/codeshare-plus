"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2Icon, SaveIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/client";
import { DESCRIPTION_MAX, TITLE_MAX, updateShareSchema } from "@/lib/validation/schemas";
import type { UpdateShareInput } from "@/lib/validation/schemas";
import { EXPIRY_OPTIONS, type PublicShare } from "@/types";

/**
 * Collection settings for an existing share.
 *
 * Password changes go through the API's explicit `passwordMode`
 * (`keep` / `set` / `clear`), which also invalidates outstanding access grants.
 * The schema is the server's own `updateShareSchema` (a refined object, so it
 * must not be re-extended); empty password inputs are normalised to `undefined`
 * by `setValueAs` instead.
 */
type FormValues = z.input<typeof updateShareSchema>;
type FormOutput = z.output<typeof updateShareSchema>;

const OPTIONAL_PASSWORD = {
  setValueAs: (value: string) => (value === "" ? undefined : value),
};

function defaultValues(share: PublicShare): FormValues {
  return {
    title: share.title,
    description: share.description ?? "",
    visibility: share.visibility,
    expiresIn: expiryFromShare(share),
    allowDownload: share.allowDownload,
    allowEdit: share.allowEdit,
    passwordMode: "keep",
    password: "",
  };
}

/** Map the absolute expiry timestamp back onto the closest option label. */
function expiryFromShare(share: PublicShare): FormValues["expiresIn"] {
  if (!share.expiresAt) return "never";
  const msLeft = new Date(share.expiresAt).getTime() - Date.now();
  const choices: Array<[NonNullable<FormValues["expiresIn"]>, number]> = [
    ["1h", 60 * 60 * 1000],
    ["24h", 24 * 60 * 60 * 1000],
    ["7d", 7 * 24 * 60 * 60 * 1000],
    ["30d", 30 * 24 * 60 * 60 * 1000],
  ];
  let best: { option: NonNullable<FormValues["expiresIn"]>; delta: number } | null = null;
  for (const [option, duration] of choices) {
    const delta = Math.abs(duration - msLeft);
    if (!best || delta < best.delta) best = { option, delta };
  }
  return best?.option ?? "7d";
}

export interface ShareSettingsFormProps {
  share: PublicShare;
  onSave: (input: UpdateShareInput) => Promise<void>;
}

export function ShareSettingsForm({ share, onSave }: ShareSettingsFormProps) {
  const [serverError, setServerError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    setValue,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(updateShareSchema),
    defaultValues: defaultValues(share),
  });

  // Re-sync when the share changes (for example after a successful save).
  React.useEffect(() => {
    reset(defaultValues(share));
  }, [share, reset]);

  const passwordMode = useWatch({ control, name: "passwordMode" });
  const visibility = useWatch({ control, name: "visibility" });
  const expiresIn = useWatch({ control, name: "expiresIn" });
  const allowDownload = useWatch({ control, name: "allowDownload" });
  const allowEdit = useWatch({ control, name: "allowEdit" });

  const submit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await onSave(values);
    } catch (error) {
      setServerError(
        error instanceof ApiError
          ? error.message
          : "Could not save the settings. Please try again.",
      );
    }
  });

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div className="space-y-2">
        <Label htmlFor="settings-title">Title</Label>
        <Input id="settings-title" maxLength={TITLE_MAX} {...register("title")} />
        {errors.title ? <p className="text-sm text-destructive">{errors.title.message}</p> : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="settings-description">Description</Label>
        <Textarea
          id="settings-description"
          rows={3}
          maxLength={DESCRIPTION_MAX}
          {...register("description")}
        />
        {errors.description ? (
          <p className="text-sm text-destructive">{errors.description.message}</p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="settings-expiry">Link expires</Label>
          <Select
            value={expiresIn}
            onValueChange={(value) =>
              setValue("expiresIn", value as FormValues["expiresIn"], { shouldDirty: true })
            }
          >
            <SelectTrigger id="settings-expiry" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPIRY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="settings-visibility">Visibility</Label>
          <Select
            value={visibility}
            onValueChange={(value) =>
              setValue("visibility", value as FormValues["visibility"], { shouldDirty: true })
            }
          >
            <SelectTrigger id="settings-visibility" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unlisted">Unlisted</SelectItem>
              <SelectItem value="public">Public</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="settings-password-mode">Password protection</Label>
        <Select
          value={passwordMode}
          onValueChange={(value) =>
            setValue("passwordMode", value as FormValues["passwordMode"], { shouldDirty: true })
          }
        >
          <SelectTrigger id="settings-password-mode" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="keep">
              {share.hasPassword ? "Keep the current password" : "No password"}
            </SelectItem>
            <SelectItem value="set">
              {share.hasPassword ? "Replace the password" : "Set a password"}
            </SelectItem>
            {share.hasPassword ? <SelectItem value="clear">Remove the password</SelectItem> : null}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          Changing the password immediately invalidates the access links people already unlocked.
        </p>
      </div>

      {passwordMode === "set" ? (
        <div className="space-y-2">
          <Label htmlFor="settings-password">New password</Label>
          <Input
            id="settings-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.password)}
            {...register("password", OPTIONAL_PASSWORD)}
          />
          {errors.password ? (
            <p className="text-sm text-destructive">{errors.password.message}</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
        <div className="space-y-1">
          <Label htmlFor="settings-download">Allow downloads</Label>
          <p className="text-sm text-muted-foreground">Original files and ZIP export.</p>
        </div>
        <Switch
          id="settings-download"
          checked={allowDownload}
          onCheckedChange={(checked) => setValue("allowDownload", checked, { shouldDirty: true })}
        />
      </div>

      <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
        <div className="space-y-1">
          <Label htmlFor="settings-edit">Collaborative</Label>
          <p className="text-sm text-muted-foreground">Mark this collection as collaborative.</p>
        </div>
        <Switch
          id="settings-edit"
          checked={allowEdit}
          onCheckedChange={(checked) => setValue("allowEdit", checked, { shouldDirty: true })}
        />
      </div>

      {serverError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          {serverError}
        </p>
      ) : null}

      <Button type="submit" disabled={isSubmitting || !isDirty}>
        {isSubmitting ? (
          <Loader2Icon className="animate-spin" aria-hidden="true" />
        ) : (
          <SaveIcon aria-hidden="true" />
        )}
        Save settings
      </Button>
    </form>
  );
}
