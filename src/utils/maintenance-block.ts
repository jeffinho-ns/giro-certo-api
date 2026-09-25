import { queryOne } from '../lib/db';

/**
 * Bloqueio por manutenção deve olhar só o **último** log por peça
 * (bikeId + partName). Logs antigos CRITICO não devem impedir aceitar
 * depois do motoboy marcar a manutenção como feita.
 */
export async function userHasActiveCriticalMaintenance(
  userId: string
): Promise<boolean> {
  const row = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1
       FROM (
         SELECT DISTINCT ON (ml."bikeId", ml."partName")
           ml.status,
           ml."wearPercentage"
         FROM "MaintenanceLog" ml
         WHERE ml."userId" = $1
         ORDER BY ml."bikeId", ml."partName", ml."createdAt" DESC
       ) latest
       WHERE latest.status = 'CRITICO'
          OR COALESCE(latest."wearPercentage", 0) >= 0.9
     ) AS exists`,
    [userId]
  );
  return !!row?.exists;
}

/** SQL fragment (boolean) — mesmo critério, para queries embutidas. */
export const SQL_USER_HAS_ACTIVE_CRITICAL_MAINTENANCE = `
  EXISTS(
    SELECT 1
    FROM (
      SELECT DISTINCT ON (ml."bikeId", ml."partName")
        ml.status,
        ml."wearPercentage"
      FROM "MaintenanceLog" ml
      WHERE ml."userId" = u.id
      ORDER BY ml."bikeId", ml."partName", ml."createdAt" DESC
    ) latest
    WHERE latest.status = 'CRITICO'
       OR COALESCE(latest."wearPercentage", 0) >= 0.9
  )
`;
