/**
 * Storage driver contract.
 *
 * Two implementations exist:
 *   - `supabase`: private Supabase Storage bucket, service-role server access,
 *     short-lived signed URLs for large/direct transfers.
 *   - `local`: filesystem storage for development and automated tests.
 *
 * Guarantees expected from every driver:
 *   - object keys are opaque, server-generated and validated before use
 *   - no path traversal, no overwrites (put must fail on existing keys)
 *   - byte-accurate size reporting for verification
 */

export interface PutObjectInput {
  key: string;
  body: Uint8Array;
  contentType: string;
}

export interface StoredObjectInfo {
  size: number;
  contentType: string | null;
}

export interface SignedUpload {
  /** Path within the bucket (same as the key). */
  path: string;
  /** Token for supabase-js `uploadToSignedUrl`. */
  token: string;
  /** Fully signed URL usable with a raw PUT. */
  signedUrl: string;
}

export interface StorageDriver {
  readonly name: "local" | "supabase";

  /** Store a new object. Must fail (not overwrite) when the key exists. */
  put(input: PutObjectInput): Promise<void>;

  /** Object metadata, or null when it does not exist. */
  head(key: string): Promise<StoredObjectInfo | null>;

  /** Full read. Callers must bound the expected size (previews, ZIP archives). */
  get(key: string): Promise<Uint8Array | null>;

  /** Partial read used for magic-byte verification without loading whole files. */
  readRange(key: string, offset: number, length: number): Promise<Uint8Array | null>;

  delete(key: string): Promise<void>;

  /** Delete every object under a prefix; returns the number of deleted objects. */
  deletePrefix(prefix: string): Promise<number>;

  /** Direct-to-storage upload URL for files above the server proxy limit. */
  createSignedUpload(key: string): Promise<SignedUpload | null>;

  /**
   * Short-lived URL that streams the object directly. Returns null when the
   * driver cannot produce one (the route then streams through the server).
   */
  createSignedDownload(
    key: string,
    expiresInSeconds: number,
    downloadFilename?: string,
  ): Promise<string | null>;
}
