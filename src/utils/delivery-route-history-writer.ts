import { query, queryOne } from '../lib/db';
import { generateId } from './id';

let tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  await query(
    `CREATE TABLE IF NOT EXISTS "DeliveryRouteHistory" (
      id TEXT PRIMARY KEY,
      "deliveryOrderId" TEXT NOT NULL REFERENCES "DeliveryOrder"(id) ON DELETE CASCADE,
      "riderId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      heading DOUBLE PRECISION NULL,
      speed DOUBLE PRECISION NULL,
      source TEXT NOT NULL DEFAULT 'gps',
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );
  await query(
    `CREATE INDEX IF NOT EXISTS "idx_delivery_route_history_order_ts"
     ON "DeliveryRouteHistory" ("deliveryOrderId", timestamp DESC)`
  );
  tableEnsured = true;
}

const MIN_ROUTE_HISTORY_POINT_MS = 30_000;
const lastRouteHistoryInsertByOrderId = new Map<string, number>();

export async function recordDeliveryRouteHistoryPointIfActive(params: {
  riderId: string;
  latitude: number;
  longitude: number;
  heading?: number | null;
  speed?: number | null;
}): Promise<string | null> {
  await ensureTable();
  const order = await queryOne<{ id: string }>(
    `SELECT id FROM "DeliveryOrder"
     WHERE "riderId" = $1 AND status IN ('accepted','arrivedAtStore','inTransit','inProgress')
     ORDER BY COALESCE("acceptedAt", "createdAt") DESC
     LIMIT 1`,
    [params.riderId]
  );
  if (!order) return null;

  const now = Date.now();
  const prev = lastRouteHistoryInsertByOrderId.get(order.id) ?? 0;
  if (now - prev < MIN_ROUTE_HISTORY_POINT_MS) {
    return null;
  }
  lastRouteHistoryInsertByOrderId.set(order.id, now);

  await query(
    `INSERT INTO "DeliveryRouteHistory"
      (id, "deliveryOrderId", "riderId", latitude, longitude, heading, speed, source, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'gps', NOW())`,
    [
      generateId(),
      order.id,
      params.riderId,
      params.latitude,
      params.longitude,
      params.heading ?? null,
      params.speed ?? null,
    ]
  );
  return order.id;
}
