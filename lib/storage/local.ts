import "server-only";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rm, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  PutObjectInput,
  SignedUpload,
  StorageDriver,
  StoredObjectInfo,
} from "@/lib/storage/types";
import { localStorageDir } from "@/lib/config/env";
import { isValidStorageKey } from "@/lib/security/filenames";
import { AppError } from "@/lib/errors";

/**
 * Filesystem storage driver (development and automated tests).
 *
 * - Base directory is configurable (LOCAL_STORAGE_DIR, default .data/storage).
 * - Object keys are validated and resolved strictly inside the base directory
 *   (traversal defence in depth).
 * - Writes are atomic (temp file + rename) and refuse to overwrite.
 */

export class LocalStorageDriver implements StorageDriver {
  readonly name = "local" as const;
  private readonly baseDir: string;

  constructor(baseDir = localStorageDir()) {
    this.baseDir = path.resolve(baseDir);
  }

  private resolve(key: string): string {
    if (!isValidStorageKey(key)) {
      throw new AppError("validation_error", "Invalid storage key.", { status: 400 });
    }
    const full = path.resolve(this.baseDir, key);
    if (full !== this.baseDir && !full.startsWith(this.baseDir + path.sep)) {
      throw new AppError("validation_error", "Invalid storage key.", { status: 400 });
    }
    return full;
  }

  async put(input: PutObjectInput): Promise<void> {
    const full = this.resolve(input.key);
    await mkdir(path.dirname(full), { recursive: true });
    const temp = `${full}.tmp-${process.pid}-${Date.now()}`;
    // `wx` semantics: refuse to overwrite an existing object.
    const handle = await open(temp, "wx");
    try {
      await handle.writeFile(input.body);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temp, full);
    } catch (error) {
      await unlink(temp).catch(() => {});
      throw error;
    }
  }

  /** Overwrite semantics used only by the reservation completion path. */
  async putOverwrite(input: PutObjectInput): Promise<void> {
    const full = this.resolve(input.key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, input.body);
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    try {
      const info = await stat(this.resolve(key));
      if (!info.isFile()) return null;
      return { size: info.size, contentType: null };
    } catch {
      return null;
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const data = await readFile(this.resolve(key));
      return new Uint8Array(data);
    } catch {
      return null;
    }
  }

  async readRange(key: string, offset: number, length: number): Promise<Uint8Array | null> {
    try {
      const handle = await open(this.resolve(key), "r");
      try {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        return new Uint8Array(buffer.subarray(0, bytesRead));
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    }
  }

  /** Node stream used by proxy download routes (local driver only). */
  stream(key: string, range?: { start: number; end: number }) {
    return createReadStream(
      this.resolve(key),
      range ? { start: range.start, end: range.end } : undefined,
    );
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<number> {
    if (!prefix.startsWith("shares/") || prefix.includes("..")) {
      throw new AppError("validation_error", "Invalid storage prefix.", { status: 400 });
    }
    const full = path.resolve(this.baseDir, prefix);
    if (full !== this.baseDir && !full.startsWith(this.baseDir + path.sep)) {
      throw new AppError("validation_error", "Invalid storage prefix.", { status: 400 });
    }
    const { readdir } = await import("node:fs/promises");
    let deleted = 0;
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const child = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(child);
          await rm(child, { recursive: true, force: true }).catch(() => {});
        } else {
          await rm(child, { force: true }).catch(() => {});
          deleted += 1;
        }
      }
    };
    await walk(full);
    return deleted;
  }

  async createSignedUpload(_key: string): Promise<SignedUpload | null> {
    // Direct-to-storage uploads are not available for local storage; the server
    // proxy path is always used in development (see lib/uploads/service.ts).
    return null;
  }

  async createSignedDownload(
    _key: string,
    _expiresInSeconds: number,
    _downloadFilename?: string,
  ): Promise<string | null> {
    // Local driver streams through the authorized route instead of signing URLs.
    return null;
  }
}
