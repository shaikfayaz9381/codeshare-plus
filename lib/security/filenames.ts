/**
 * Filename handling.
 *
 * Client-supplied filenames are treated as untrusted input: they are displayed,
 * optionally embedded in archive entry names, and never used directly as
 * storage paths (storage keys are generated server-side from server IDs plus a
 * sanitized slug).
 */

const MAX_FILENAME_LENGTH = 180;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/** Strip directory components (handles both separators), control characters and reserved names. */
export function sanitizeFilename(input: string, fallback = "file"): string {
  let name = (input ?? "").toString();

  // Remove any path component (POSIX and Windows separators, including encoded ones).
  name = name.split(/[\\/]/).pop() ?? "";
  name = name.replace(CONTROL_CHARS, "").trim();

  // Windows-reserved device names.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name)) {
    name = `_${name}`;
  }

  // Remove leading dots (hidden files) — keeps display predictable.
  name = name.replace(/^\.+/, "");

  name = name.replace(/[\s]+/g, " ").trim();

  if (!name) name = fallback;

  if (name.length > MAX_FILENAME_LENGTH) {
    const ext = extensionOf(name);
    const base = name.slice(0, MAX_FILENAME_LENGTH - (ext ? ext.length + 1 : 0));
    name = ext ? `${base}.${ext}` : name.slice(0, MAX_FILENAME_LENGTH);
  }

  return name;
}

/** Extension must look like one (`pdf`, `tar`), never arbitrary trailing text. */
const EXTENSION_PATTERN = /^[A-Za-z0-9]{1,16}$/;

/**
 * Lowercase extension without the dot, or empty string.
 *
 * Deliberately does *not* call `sanitizeFilename` (which calls back into this
 * function when truncating long names) — it only inspects the last path
 * component, so it is safe to call on untrusted input.
 */
export function extensionOf(filename: string): string {
  const last = (filename ?? "").toString().split(/[\\/]/).pop() ?? "";
  const idx = last.lastIndexOf(".");
  if (idx <= 0 || idx === last.length - 1) return "";
  const ext = last.slice(idx + 1);
  return EXTENSION_PATTERN.test(ext) ? ext.toLowerCase() : "";
}

/**
 * Storage object key. Entirely server-generated:
 *   shares/<share-uuid>/<item-uuid>/<slug>
 * `slug` keeps a sanitized filename so operators can recognize objects, but the
 * key is never derived from user input in a way that permits traversal or
 * collisions (UUID segments guarantee uniqueness).
 */
export function buildItemStorageKey(shareUuid: string, itemId: string, filename: string): string {
  const slug = sanitizeFilename(filename, "file")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 80);
  return `shares/${shareUuid}/${itemId}/${slug || "file"}`;
}

/** Storage key for an in-progress direct upload (before the item exists). */
export function buildReservationStorageKey(
  shareUuid: string,
  reservationId: string,
  filename: string,
): string {
  const slug = sanitizeFilename(filename, "file")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 80);
  return `shares/${shareUuid}/uploads/${reservationId}/${slug || "file"}`;
}

/** Reject keys that are not the canonical shape produced above (defence in depth). */
export function isValidStorageKey(key: string): boolean {
  if (typeof key !== "string" || key.length === 0 || key.length > 512) return false;
  if (key.startsWith("/") || key.includes("..") || key.includes("\\")) return false;
  return /^shares\/[0-9a-f-]{36}\/(?:uploads\/)?[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/.test(key);
}

/** Extract the share UUID an object key belongs to (for cross-share checks). */
export function shareUuidFromStorageKey(key: string): string | null {
  const m = /^shares\/([0-9a-f-]{36})\//.exec(key);
  return m?.[1] ?? null;
}

/**
 * Make an archive entry name safe and unique.
 * - no path separators, no traversal
 * - empty names get a fallback
 * - duplicates receive " (2)", " (3)", ... suffixes
 */
export function uniqueArchiveEntryName(name: string, used: Set<string>): string {
  let candidate = sanitizeFilename(name, "file");
  if (candidate.trim() === "") candidate = "file";
  if (!used.has(candidate.toLowerCase())) {
    used.add(candidate.toLowerCase());
    return candidate;
  }
  // Preserve the original extension spelling ("REPORT.PDF" -> "REPORT (2).PDF").
  const dot = candidate.lastIndexOf(".");
  const rawExt = dot > 0 && dot < candidate.length - 1 ? candidate.slice(dot) : "";
  const ext = EXTENSION_PATTERN.test(rawExt.slice(1)) ? rawExt : "";
  const base = ext ? candidate.slice(0, -ext.length) : candidate;
  let n = 2;
  for (;;) {
    const next = ext ? `${base} (${n})${ext}` : `${base} (${n})`;
    if (!used.has(next.toLowerCase())) {
      used.add(next.toLowerCase());
      return next;
    }
    n += 1;
  }
}
