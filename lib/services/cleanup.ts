import "server-only";
import {
  claimExpiredReservations,
  deleteStaleReservations,
} from "@/lib/db/repositories/reservations";
import { deleteExpiredGrants } from "@/lib/db/repositories/grants";
import { pruneUsageCounters } from "@/lib/db/repositories/counters";
import { getStorage } from "@/lib/storage";
import { purgeExpiredShares } from "@/lib/services/shares";

/**
 * Maintenance jobs.
 *
 * Called by /api/cron/maintenance (Vercel Cron) and safe to run repeatedly:
 *  - abandoned upload reservations: delete the object, mark the row expired
 *  - old terminal reservation rows: delete
 *  - expired access grants: delete
 *  - usage counters: prune
 *  - revoked/expired shares: delete after the retention window
 */

export interface MaintenanceReport {
  abandonedUploads: number;
  abandonedObjects: number;
  staleReservations: number;
  expiredGrants: number;
  prunedCounters: number;
  purgedShares: number;
  purgedObjects: number;
}

export async function runMaintenance(
  options: { shareRetentionDays?: number; limit?: number } = {},
): Promise<MaintenanceReport> {
  const limit = options.limit ?? 50;
  const retentionDays = options.shareRetentionDays ?? 30;
  const storage = getStorage();

  const expired = await claimExpiredReservations(limit);
  let abandonedObjects = 0;
  for (const reservation of expired) {
    try {
      await storage.delete(reservation.storage_key);
      abandonedObjects += 1;
    } catch {
      // object may not exist; keep going
    }
  }

  const staleReservations = await deleteStaleReservations(48);
  const expiredGrants = await deleteExpiredGrants();
  const prunedCounters = await pruneUsageCounters("2 days");
  const purged = await purgeExpiredShares(retentionDays, 25);

  return {
    abandonedUploads: expired.length,
    abandonedObjects,
    staleReservations,
    expiredGrants,
    prunedCounters,
    purgedShares: purged.shares,
    purgedObjects: purged.objects,
  };
}
