import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  PutObjectInput,
  SignedUpload,
  StorageDriver,
  StoredObjectInfo,
} from "@/lib/storage/types";
import { storageBucket, supabaseAuthConfig, supabaseServiceRoleKey } from "@/lib/config/env";
import { isValidStorageKey } from "@/lib/security/filenames";
import { AppError } from "@/lib/errors";

/**
 * Supabase Storage driver.
 *
 * - Uses the service-role key (server-only; RLS is bypassed by design for the
 *   server, bucket policies deny client access — see migrations 0004).
 * - `put` uses `upsert: false` so server-generated keys can never be overwritten.
 * - `readRange` fetches through a short-lived signed URL with a Range header
 *   instead of downloading whole objects (used for magic-byte verification).
 */

let cachedClient: SupabaseClient | null = null;

function serviceClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const { url } = supabaseAuthConfig();
  const serviceKey = supabaseServiceRoleKey();
  cachedClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

function assertKey(key: string): void {
  if (!isValidStorageKey(key)) {
    throw new AppError("validation_error", "Invalid storage key.", { status: 400 });
  }
}

export class SupabaseStorageDriver implements StorageDriver {
  readonly name = "supabase" as const;

  private storage() {
    return serviceClient().storage.from(storageBucket());
  }

  async put(input: PutObjectInput): Promise<void> {
    assertKey(input.key);
    const { error } = await this.storage().upload(input.key, input.body, {
      contentType: input.contentType,
      upsert: false,
    });
    if (error) {
      if (/exists/i.test(error.message)) {
        throw new AppError("conflict", "Object already exists.", { status: 409 });
      }
      throw new AppError("storage_unavailable", `Storage upload failed: ${error.message}`, {
        status: 502,
        expose: false,
      });
    }
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    assertKey(key);
    const { data, error } = await this.storage().info(key);
    if (error || !data) return null;
    const meta = data as { size?: number; mimetype?: string | null } & Record<string, unknown>;
    return {
      size: Number(meta.size ?? 0),
      contentType: (meta.mimetype as string | null | undefined) ?? null,
    };
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertKey(key);
    const { data, error } = await this.storage().download(key);
    if (error || !data) return null;
    const buffer = await data.arrayBuffer();
    return new Uint8Array(buffer);
  }

  async readRange(key: string, offset: number, length: number): Promise<Uint8Array | null> {
    assertKey(key);
    const url = await this.createSignedDownload(key, 60);
    if (!url) return null;
    try {
      const response = await fetch(url, {
        headers: { Range: `bytes=${offset}-${offset + length - 1}` },
        cache: "no-store",
      });
      if (!response.ok && response.status !== 206) return null;
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    const { error } = await this.storage().remove([key]);
    if (error) {
      throw new AppError("storage_unavailable", `Storage delete failed: ${error.message}`, {
        status: 502,
        expose: false,
      });
    }
  }

  async deletePrefix(prefix: string): Promise<number> {
    if (!prefix.startsWith("shares/") || prefix.includes("..")) {
      throw new AppError("validation_error", "Invalid storage prefix.", { status: 400 });
    }
    let deleted = 0;
    const queue: string[] = [prefix.replace(/\/$/, "")];
    while (queue.length > 0) {
      const folder = queue.shift()!;
      const { data, error } = await this.storage().list(folder, { limit: 1000 });
      if (error || !data) break;
      const files: string[] = [];
      for (const entry of data) {
        const full = `${folder}/${entry.name}`;
        const isFile = entry.id !== null && entry.id !== undefined;
        if (isFile) files.push(full);
        else queue.push(full);
      }
      if (files.length > 0) {
        const { error: removeError } = await this.storage().remove(files);
        if (!removeError) deleted += files.length;
      }
    }
    return deleted;
  }

  async createSignedUpload(key: string): Promise<SignedUpload | null> {
    assertKey(key);
    const { data, error } = await this.storage().createSignedUploadUrl(key);
    if (error || !data) {
      throw new AppError(
        "storage_unavailable",
        `Could not create upload URL: ${error?.message ?? "unknown"}`,
        {
          status: 502,
          expose: false,
        },
      );
    }
    return { path: data.path, token: data.token, signedUrl: data.signedUrl };
  }

  async createSignedDownload(
    key: string,
    expiresInSeconds: number,
    downloadFilename?: string,
  ): Promise<string | null> {
    assertKey(key);
    const { data, error } = await this.storage().createSignedUrl(
      key,
      expiresInSeconds,
      downloadFilename ? { download: downloadFilename } : undefined,
    );
    if (error || !data) return null;
    return data.signedUrl;
  }
}
