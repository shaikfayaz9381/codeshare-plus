"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2Icon, PlusIcon, ShieldCheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { createShareSchema, DESCRIPTION_MAX, TITLE_MAX } from "@/lib/validation/schemas";
import { EXPIRY_OPTIONS } from "@/types";
import type { CreateShareInput } from "@/lib/validation/schemas";

/**
 * Collection details form (the first step of the builder).
 *
 * Validation reuses the server's Zod schema, so the browser cannot submit
 * anything the API would reject — and the API still validates everything again.
 * An empty password field is turned into `undefined` by the input's
 * `setValueAs` normaliser, which is exactly what the schema expects for
 * "no password".
 */
export type DetailsFormValues = z.input<typeof createShareSchema>;
export type DetailsFormOutput = z.output<typeof createShareSchema>;

const DEFAULT_VALUES: DetailsFormValues = {
  title: "",
  description: "",
  visibility: "unlisted",
  expiresIn: "7d",
  password: "",
  allowDownload: true,
  allowEdit: false,
};

const OPTIONAL_PASSWORD = {
  setValueAs: (value: string) => (value === "" ? undefined : value),
};

export interface ShareDetailsFormProps {
  onCreate: (input: CreateShareInput) => Promise<void>;
}

export function ShareDetailsForm({ onCreate }: ShareDetailsFormProps) {
  const [serverError, setServerError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<DetailsFormValues, unknown, DetailsFormOutput>({
    resolver: zodResolver(createShareSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const visibility = useWatch({ control, name: "visibility" });
  const expiresIn = useWatch({ control, name: "expiresIn" });
  const allowDownload = useWatch({ control, name: "allowDownload" });
  const allowEdit = useWatch({ control, name: "allowEdit" });

  const submit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await onCreate(values);
    } catch (error) {
      setServerError(
        error instanceof ApiError ? error.message : "Something went wrong. Please try again.",
      );
    }
  });

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-3xl space-y-6" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Name your collection</CardTitle>
          <CardDescription>
            A title is required. Everything else can be changed after you create it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              autoFocus
              placeholder="Deployment notes for the payments service"
              maxLength={TITLE_MAX}
              aria-invalid={Boolean(errors.title)}
              {...register("title")}
            />
            {errors.title ? (
              <p className="text-sm text-destructive">{errors.title.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">
              Description <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="description"
              rows={3}
              placeholder="What is in this collection, and who is it for?"
              maxLength={DESCRIPTION_MAX}
              aria-invalid={Boolean(errors.description)}
              {...register("description")}
            />
            {errors.description ? (
              <p className="text-sm text-destructive">{errors.description.message}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheckIcon className="size-4" aria-hidden="true" />
            Access rules
          </CardTitle>
          <CardDescription>
            Expiry and passwords are enforced by the server on every request.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="expiresIn">Link expires</Label>
            <Select
              value={expiresIn}
              onValueChange={(value) =>
                setValue("expiresIn", value as DetailsFormValues["expiresIn"])
              }
            >
              <SelectTrigger id="expiresIn" className="w-full">
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
            <Label htmlFor="visibility">Visibility</Label>
            <Select
              value={visibility}
              onValueChange={(value) =>
                setValue("visibility", value as DetailsFormValues["visibility"])
              }
            >
              <SelectTrigger id="visibility" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unlisted">Unlisted — only people with the link</SelectItem>
                <SelectItem value="public">Public — listed on your public profile</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="password">
              Password <span className="text-muted-foreground">(optional, min 8 characters)</span>
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder="Leave empty for no password"
              aria-invalid={Boolean(errors.password)}
              {...register("password", OPTIONAL_PASSWORD)}
            />
            {errors.password ? (
              <p className="text-sm text-destructive">{errors.password.message}</p>
            ) : null}
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
            <div className="space-y-1">
              <Label htmlFor="allowDownload">Allow downloads</Label>
              <p className="text-sm text-muted-foreground">
                Recipients can fetch original files and export a ZIP.
              </p>
            </div>
            <Switch
              id="allowDownload"
              checked={allowDownload}
              onCheckedChange={(checked) => setValue("allowDownload", checked)}
            />
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
            <div className="space-y-1">
              <Label htmlFor="allowEdit">Collaborative</Label>
              <p className="text-sm text-muted-foreground">
                Marks the collection as collaborative. Editing still requires the management link.
              </p>
            </div>
            <Switch
              id="allowEdit"
              checked={allowEdit}
              onCheckedChange={(checked) => setValue("allowEdit", checked)}
            />
          </div>
        </CardContent>
      </Card>

      {serverError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          {serverError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? (
            <Loader2Icon className="animate-spin" aria-hidden="true" />
          ) : (
            <PlusIcon aria-hidden="true" />
          )}
          Create collection
        </Button>
        <p className="text-sm text-muted-foreground">
          You can add code, notes, and files on the next screen. Nothing is public until you share
          the link.
        </p>
      </div>
    </form>
  );
}
