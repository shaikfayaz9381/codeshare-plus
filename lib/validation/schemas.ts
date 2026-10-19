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

/**
 * Custom share links (e.g. `/s/my-team-notes`).
 *
 * Constraints are deliberately conservative: lowercase letters, digits and
 * hyphens, 4-32 characters, starting and ending alphanumeric. Input is
 * normalized (trimmed + lowercased) before validation, and a small blocklist
 * keeps obviously confusing names out of circulation.
 */
export const SHARE_ID_MIN = 4;
export const SHARE_ID_MAX = 32;
export const SHARE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{2,30}[a-z0-9])$/;
export const RESERVED_SHARE_IDS = new Set([
  "about",
  "account",
  "admin",
  "api",
  "assets",
  "cron",
  "dashboard",
  "docs",
  "health",
  "help",
  "login",
  "logout",
  "manage",
  "new",
  "privacy",
  "robots",
  "s",
  "security",
  "settings",
  "signin",
  "signup",
  "static",
  "support",
  "terms",
]);

export const customShareIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(SHARE_ID_MIN, `Link must be at least ${SHARE_ID_MIN} characters.`)
  .max(SHARE_ID_MAX, `Link must be at most ${SHARE_ID_MAX} characters.`)
  .regex(
    SHARE_ID_PATTERN,
    "Use lowercase letters, numbers and hyphens; start and end with a letter or number.",
  )
  .refine((value) => !RESERVED_SHARE_IDS.has(value), "This link is reserved. Pick another one.");

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
  /** Optional vanity link; a random 22-character id is used when omitted. */
  customShareId: customShareIdSchema.optional(),
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
