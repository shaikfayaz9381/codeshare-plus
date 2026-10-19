import "server-only";
import { randomUUID } from "node:crypto";
import { storageDriverName, storageBucket } from "@/lib/config/env";
import { LocalStorageDriver } from "@/lib/storage/local";
import { SupabaseStorageDriver } from "@/lib/storage/supabase";
import type { StorageDriver } from "@/lib/storage/types";

/** Storage driver resolution (see lib/config/env.ts:storageDriverName). */

let cached: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (cached) return cached;
  const name = storageDriverName();
  cached = name === "supabase" ? new SupabaseStorageDriver() : new LocalStorageDriver();
  return cached;
}

export function resetStorageForTests(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("resetStorageForTests must not be called in production");
  }
  cached = null;
}

export { storageBucket };

/**
 * Storage availability probe used by /api/health.
 * Writes, reads and removes a tiny probe object; never throws.
 */
export async function pingStorage(): Promise<{ ok: boolean; detail: string; driver: string }> {
  let driverName = "unknown";
  try {
    const driver = getStorage();
    driverName = driver.name;

    if (driver.name === "supabase") {
      const { createClient } = await import("@supabase/supabase-js");
      const { supabaseAuthConfig, supabaseServiceRoleKey } = await import("@/lib/config/env");
      const client = createClient(supabaseAuthConfig().url, supabaseServiceRoleKey(), {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await client.storage.getBucket(storageBucket());
      return error
        ? {
            ok: false,
            detail: `bucket "${storageBucket()}" not reachable: ${error.message}`,
            driver: driver.name,
          }
        : {
            ok: true,
            detail: `private bucket "${storageBucket()}" reachable`,
            driver: driver.name,
          };
    }

    const probeKey = `shares/00000000-0000-0000-0000-000000000000/${randomUUID()}/probe.bin`;
    await driver.put({
      key: probeKey,
      body: new Uint8Array([1]),
      contentType: "application/octet-stream",
    });
    const info = await driver.head(probeKey);
    await driver.delete(probeKey);
    return info
      ? { ok: true, detail: "local filesystem storage writable", driver: driver.name }
      : { ok: false, detail: "probe object not found after write", driver: driver.name };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "storage check failed",
      driver: driverName,
    };
  }
}
