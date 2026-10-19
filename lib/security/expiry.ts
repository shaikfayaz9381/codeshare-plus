import type { ExpiryOption } from "@/types";

/** Expiration model. All checks are server-side; clients only send an option. */

export const EXPIRY_MS: Record<Exclude<ExpiryOption, "never">, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export function isExpiryOption(value: unknown): value is ExpiryOption {
  return (
    value === "1h" || value === "24h" || value === "7d" || value === "30d" || value === "never"
  );
}

/** Compute an absolute expiry timestamp from an option. `null` = never expires. */
export function computeExpiresAt(option: ExpiryOption, now: Date = new Date()): Date | null {
  if (option === "never") return null;
  return new Date(now.getTime() + EXPIRY_MS[option]);
}

export function isExpired(
  expiresAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) return false;
  const value = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  if (Number.isNaN(value.getTime())) return true; // malformed timestamps fail closed
  return value.getTime() <= now.getTime();
}

/** Human-readable remaining lifetime; used by the UI and API responses. */
export function describeExpiry(expiresAt: Date | string | null, now: Date = new Date()): string {
  if (!expiresAt) return "Never expires";
  const value = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  const diff = value.getTime() - now.getTime();
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.floor(diff / 60_000))} min left`;
  if (hours < 48) return `${hours} h left`;
  return `${Math.floor(hours / 24)} d left`;
}

/** The default lifetime for new shares (secure-by-default: expires in 7 days). */
export const DEFAULT_EXPIRY: ExpiryOption = "7d";
