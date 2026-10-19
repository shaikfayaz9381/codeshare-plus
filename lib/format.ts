/**
 * Presentation helpers shared by client and server components.
 *
 * Dates are formatted in UTC with an explicit label so the server and the
 * browser always render the same string (no hydration mismatches from locale
 * or timezone differences).
 */

const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

/** Human-readable byte size, e.g. `1.4 MB`. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const fixed = value.toFixed(decimals);
  // Trim only the decimal part: "1.50" -> "1.5", "10.0" -> "10", "250" stays.
  const trimmed = fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
  return `${trimmed} ${BYTE_UNITS[unit]}`;
}

const UTC_DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

/** Deterministic date-time string, e.g. `19 Oct 2026, 09:41 UTC`. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${UTC_DATE_TIME.format(date)} UTC`;
}

/** Remaining lifetime of a share, evaluated against the given time. */
export function describeRemaining(
  expiresAt: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!expiresAt) return "Never expires";
  const target = new Date(expiresAt);
  if (Number.isNaN(target.getTime())) return "Unknown";
  const diff = target.getTime() - now.getTime();
  if (diff <= 0) return "Expired";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "Less than a minute left";
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h left`;
  return `${Math.floor(hours / 24)} d left`;
}

/** Truncate a title for compact list rendering. */
export function truncate(value: string, max = 60): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 1))}…`;
}
