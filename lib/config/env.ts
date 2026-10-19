import "server-only";
import { z } from "zod";

/**
 * Server configuration.
 *
 * Design goals:
 * - Validation is lazy (at first use), so `next build` does not require a fully
 *   configured environment, but any real operation fails with an actionable,
 *   secret-free error message.
 * - Nothing in here is ever sent to the browser. Public values are read directly
 *   from `process.env.NEXT_PUBLIC_*` where needed (Next.js inlines those).
 * - Missing configuration is reported by name only, never by value.
 */

const intFromString = (def: number) =>
  z
    .preprocess((v) => {
      if (v === undefined || v === "") return undefined;
      return Number(v);
    }, z.number().int().positive())
    .default(def);

/** 1 MiB / 1 MB helpers (we use binary units internally). */
export const MiB = 1024 * 1024;

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Public
  NEXT_PUBLIC_APP_URL: z.string().min(1).default("http://localhost:3000"),

  // Database (Supabase Postgres connection string; session pooler or direct)
  DATABASE_URL: z.string().min(1).optional(),

  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().min(1).optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default("share-files"),

  // Storage driver
  STORAGE_DRIVER: z.enum(["local", "supabase"]).optional(),
  LOCAL_STORAGE_DIR: z.string().min(1).default(".data/storage"),

  // Upload limits (MB)
  MAX_UPLOAD_MB: intFromString(50),
  MAX_PROXIED_UPLOAD_MB: intFromString(4),
  MAX_SHARE_TOTAL_MB: intFromString(500),
  MAX_ITEMS_PER_SHARE: intFromString(50),
  MAX_FILES_PER_SHARE: intFromString(25),
  MAX_TEXT_ITEM_KB: intFromString(200),
  MAX_ZIP_TOTAL_MB: intFromString(200),
  MAX_TEXT_PREVIEW_KB: intFromString(512),
  MAX_CSV_PREVIEW_MB: intFromString(2),
  MAX_MARKDOWN_PREVIEW_KB: intFromString(512),

  // Abuse controls
  RATE_LIMIT_CREATE_PER_HOUR: intFromString(10),
  RATE_LIMIT_PASSWORD_PER_15MIN: intFromString(10),
  RATE_LIMIT_UPLOAD_PER_HOUR: intFromString(60),
  RATE_LIMIT_READ_PER_MINUTE: intFromString(300),
  RATE_LIMIT_GUEST_BYTES_PER_DAY_MB: intFromString(500),

  // Password hashing
  BCRYPT_COST: z
    .preprocess(
      (v) => (v === undefined || v === "" ? undefined : Number(v)),
      z.number().int().min(10).max(15),
    )
    .default(12),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;
let cachedError: string | null = null;

function readEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    cachedError = `Invalid server configuration: ${issues}`;
    throw new Error(cachedError);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: resets the memoized environment (never used in production code paths). */
export function __resetEnvCacheForTests(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("__resetEnvCacheForTests must not be called in production");
  }
  cached = null;
  cachedError = null;
}

export class ConfigurationError extends Error {
  readonly code = "config_missing";
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

function requireValue(name: keyof ServerEnv, why: string, value: string | undefined): string {
  if (!value) {
    const where =
      process.env.NODE_ENV === "production"
        ? "Set it in your hosting provider's environment variables (Render: service -> Environment; " +
          "Vercel: Project -> Settings -> Environment Variables) and redeploy."
        : "Add it to .env.local (see .env.example).";
    throw new ConfigurationError(`Missing required configuration "${name}". ${why} ${where}`);
  }
  return value;
}

/** Database connection string. Required for every persisted operation. */
export function databaseUrl(): string {
  const env = readEnv();
  return requireValue(
    "DATABASE_URL",
    "This is the PostgreSQL connection string used for all data access " +
      "(Supabase: Project Settings -> Database -> Connection string).",
    env.DATABASE_URL,
  );
}

export function appUrl(): string {
  return readEnv().NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
}

export function nodeEnv(): ServerEnv["NODE_ENV"] {
  return readEnv().NODE_ENV;
}

export function bcryptCost(): number {
  return readEnv().BCRYPT_COST;
}

export function storageBucket(): string {
  return readEnv().SUPABASE_STORAGE_BUCKET;
}

export function localStorageDir(): string {
  return readEnv().LOCAL_STORAGE_DIR;
}

export type StorageDriverName = "local" | "supabase";

/**
 * Storage driver resolution.
 * - explicit STORAGE_DRIVER wins
 * - otherwise: supabase when a service-role key exists, local in dev/test
 * - in production an explicit choice is required
 */
export function storageDriverName(): StorageDriverName {
  const env = readEnv();
  if (env.STORAGE_DRIVER) return env.STORAGE_DRIVER;
  if (env.SUPABASE_SERVICE_ROLE_KEY) return "supabase";
  if (env.NODE_ENV === "production") {
    throw new ConfigurationError(
      'No storage backend configured in production. Set STORAGE_DRIVER="supabase" and SUPABASE_SERVICE_ROLE_KEY, ' +
        'or run a single-instance deployment with STORAGE_DRIVER="local" (not recommended: local storage does not ' +
        "survive serverless deployments).",
    );
  }
  return "local";
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

/** Supabase Auth configuration (URL + anon key). Required for accounts. */
export function supabaseAuthConfig(): SupabaseConfig {
  const env = readEnv();
  return {
    url: requireValue(
      "NEXT_PUBLIC_SUPABASE_URL",
      "Required for authentication. Supabase: Project Settings -> API -> Project URL.",
      env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    anonKey: requireValue(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "Required for authentication. Supabase: Project Settings -> API -> anon public key.",
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
  };
}

export function supabaseServiceRoleKey(): string {
  const env = readEnv();
  return requireValue(
    "SUPABASE_SERVICE_ROLE_KEY",
    "Required by the Supabase storage driver. Server-side only - never expose this key.",
    env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export interface Limits {
  maxUploadBytes: number;
  maxProxiedUploadBytes: number;
  maxShareTotalBytes: number;
  maxItemsPerShare: number;
  maxFilesPerShare: number;
  maxTextItemBytes: number;
  maxZipTotalBytes: number;
  maxTextPreviewBytes: number;
  maxCsvPreviewBytes: number;
  maxMarkdownPreviewBytes: number;
  rateLimitCreatePerHour: number;
  rateLimitPasswordPer15Min: number;
  rateLimitUploadPerHour: number;
  rateLimitReadPerMinute: number;
  rateLimitGuestBytesPerDay: number;
  rateLimitPasswordWindowSeconds: number;
}

export function limits(): Limits {
  const env = readEnv();
  return {
    maxUploadBytes: env.MAX_UPLOAD_MB * MiB,
    maxProxiedUploadBytes: Math.min(env.MAX_PROXIED_UPLOAD_MB, env.MAX_UPLOAD_MB) * MiB,
    maxShareTotalBytes: env.MAX_SHARE_TOTAL_MB * MiB,
    maxItemsPerShare: env.MAX_ITEMS_PER_SHARE,
    maxFilesPerShare: env.MAX_FILES_PER_SHARE,
    maxTextItemBytes: env.MAX_TEXT_ITEM_KB * 1024,
    maxZipTotalBytes: env.MAX_ZIP_TOTAL_MB * MiB,
    maxTextPreviewBytes: env.MAX_TEXT_PREVIEW_KB * 1024,
    maxCsvPreviewBytes: env.MAX_CSV_PREVIEW_MB * MiB,
    maxMarkdownPreviewBytes: env.MAX_MARKDOWN_PREVIEW_KB * 1024,
    rateLimitCreatePerHour: env.RATE_LIMIT_CREATE_PER_HOUR,
    rateLimitPasswordPer15Min: env.RATE_LIMIT_PASSWORD_PER_15MIN,
    rateLimitUploadPerHour: env.RATE_LIMIT_UPLOAD_PER_HOUR,
    rateLimitReadPerMinute: env.RATE_LIMIT_READ_PER_MINUTE,
    rateLimitGuestBytesPerDay: env.RATE_LIMIT_GUEST_BYTES_PER_DAY_MB * MiB,
    rateLimitPasswordWindowSeconds: 15 * 60,
  };
}

export interface EnvStatus {
  appUrl: string;
  nodeEnv: string;
  database: { configured: boolean };
  auth: { configured: boolean };
  storage: {
    driver: StorageDriverName | null;
    configured: boolean;
    bucket: string;
    detail: string;
  };
  configError: string | null;
}

/**
 * Safe configuration status for the health endpoint. Never includes values of
 * secrets - only booleans and non-sensitive identifiers.
 */
export function envStatus(): EnvStatus {
  let env: ServerEnv;
  try {
    env = readEnv();
  } catch {
    return {
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
      nodeEnv: process.env.NODE_ENV ?? "unknown",
      database: { configured: false },
      auth: { configured: false },
      storage: { driver: null, configured: false, bucket: "", detail: "Invalid configuration" },
      configError: cachedError ?? "Invalid configuration",
    };
  }

  const authConfigured = Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const databaseConfigured = Boolean(env.DATABASE_URL);

  let driver: StorageDriverName | null = null;
  let storageConfigured = false;
  let detail = "";
  try {
    driver = storageDriverName();
    if (driver === "supabase") {
      storageConfigured = Boolean(env.SUPABASE_SERVICE_ROLE_KEY && env.NEXT_PUBLIC_SUPABASE_URL);
      detail = storageConfigured
        ? "Private Supabase Storage bucket configured."
        : "SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL missing.";
    } else {
      storageConfigured = true;
      detail = "Local filesystem storage (development/testing only).";
    }
  } catch (e) {
    detail = e instanceof Error ? e.message : "Storage configuration error";
  }

  return {
    appUrl: env.NEXT_PUBLIC_APP_URL,
    nodeEnv: env.NODE_ENV,
    database: { configured: databaseConfigured },
    auth: { configured: authConfigured },
    storage: { driver, configured: storageConfigured, bucket: env.SUPABASE_STORAGE_BUCKET, detail },
    configError: null,
  };
}

/** Public limits for the client (safe: they describe policy, not secrets). */
export function publicLimits() {
  const l = limits();
  return {
    maxUploadBytes: l.maxUploadBytes,
    maxProxiedUploadBytes: l.maxProxiedUploadBytes,
    maxItemsPerShare: l.maxItemsPerShare,
    maxFilesPerShare: l.maxFilesPerShare,
    maxTextItemBytes: l.maxTextItemBytes,
  };
}
