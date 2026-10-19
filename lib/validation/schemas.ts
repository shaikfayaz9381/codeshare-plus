import { z } from "zod";
import { CODE_LANGUAGES } from "@/types";

/**
 * Zod schemas for every external input boundary.
 *
 * These schemas are isomorphic (usable in client forms and server handlers).
 * Environment-dependent limits (byte sizes, quotas) are enforced in the service
 * layer with `limits()`; schemas here enforce shape and static caps.
 */

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 5000;
/** Static cap for editor payloads; the byte limit (default 200 KB) is enforced server-side. */
export const CONTENT_MAX_CHARS = 1_000_000;

export const titleSchema = z
  .string()
  .trim()
  .min(1, "Title is required.")
  .max(TITLE_MAX, `Title must be ${TITLE_MAX} characters or fewer.`);

export const descriptionSchema = z
  .string()
  .trim()
  .max(DESCRIPTION_MAX, `Description must be ${DESCRIPTION_MAX} characters or fewer.`)
  .transform((v) => (v === "" ? null : v))
  .nullable();

export const visibilitySchema = z.enum(["public", "unlisted"]);
export const expiryOptionSchema = z.enum(["1h", "24h", "7d", "30d", "never"]);
export const languageSchema = z.enum(CODE_LANGUAGES);

export const sharePasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be at most 128 characters.");

export const createShareSchema = z.object({
  title: titleSchema,
  description: descriptionSchema.optional(),
  visibility: visibilitySchema.default("unlisted"),
  expiresIn: expiryOptionSchema.default("7d"),
  password: sharePasswordSchema.nullish(),
  allowDownload: z.boolean().default(true),
  allowEdit: z.boolean().default(false),
});
export type CreateShareInput = z.infer<typeof createShareSchema>;

export const updateShareSchema = z
  .object({
    title: titleSchema.optional(),
    description: descriptionSchema.optional(),
    visibility: visibilitySchema.optional(),
    expiresIn: expiryOptionSchema.optional(),
    allowDownload: z.boolean().optional(),
    allowEdit: z.boolean().optional(),
    passwordMode: z.enum(["keep", "set", "clear"]).default("keep"),
    password: sharePasswordSchema.nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.passwordMode === "set" && (!value.password || value.password.length < 8)) {
      ctx.addIssue({
        code: "custom",
        path: ["password"],
        message: "A password of at least 8 characters is required when enabling protection.",
      });
    }
  });
export type UpdateShareInput = z.infer<typeof updateShareSchema>;

export const itemContentSchema = z
  .string()
  .min(1, "Content is required.")
  .max(CONTENT_MAX_CHARS, "Content is too large.");

export const createCodeItemSchema = z.object({
  type: z.literal("code"),
  title: titleSchema,
  content: itemContentSchema,
  language: languageSchema.default("plaintext"),
});

export const createTextItemSchema = z.object({
  type: z.literal("text"),
  title: titleSchema,
  content: itemContentSchema,
});

export const createItemSchema = z.discriminatedUnion("type", [
  createCodeItemSchema,
  createTextItemSchema,
]);
export type CreateItemInput = z.infer<typeof createItemSchema>;

export const updateItemSchema = z
  .object({
    title: titleSchema.optional(),
    content: itemContentSchema.optional(),
    language: languageSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No changes supplied." });
export type UpdateItemInput = z.infer<typeof updateItemSchema>;

export const reorderItemsSchema = z.object({
  itemIds: z
    .array(z.string().uuid("Invalid item id."))
    .min(1, "At least one item is required.")
    .max(500, "Too many items.")
    .refine((ids) => new Set(ids).size === ids.length, "Item ids must be unique."),
});
export type ReorderItemsInput = z.infer<typeof reorderItemsSchema>;

export const verifyPasswordSchema = z.object({
  password: z.string().min(1, "Password is required.").max(128, "Password is too long."),
});
export type VerifyPasswordInput = z.infer<typeof verifyPasswordSchema>;

export const reserveUploadSchema = z.object({
  filename: z.string().trim().min(1, "Filename is required.").max(255, "Filename is too long."),
  size: z.number().int().positive("File size must be positive."),
  mimeType: z.string().max(255).optional(),
});
export type ReserveUploadInput = z.infer<typeof reserveUploadSchema>;

export const dashboardQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  visibility: z.enum(["public", "unlisted"]).optional(),
  status: z.enum(["active", "expired", "revoked", "password", "all"]).default("all"),
  sort: z
    .enum(["created_desc", "created_asc", "updated_desc", "title_asc"])
    .default("created_desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce.number().int().min(1).max(50).default(12),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

/** Extract a flat list of {path, message} issues for API error details. */
export function zodIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
}
