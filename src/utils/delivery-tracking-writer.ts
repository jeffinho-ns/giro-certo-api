import { query, queryOne } from '../lib/db';
import { generateId } from './id';

const MIN_INTERVAL_MS = 20_000;

/**
 * Grava ponto de rastreio quando o rider tem pedido ativo (throttle por pedido).
 */
export async function recordDeliveryTrackingIfDue(
  riderId: string,
  latitude: number,
  longitude: number
): Promise<void> {
  const order = await queryOne<{ id: string }>(
    `SELECT id FROM "DeliveryOrder"
     WHERE "riderId" = $1 AND status IN ('accepted','arrivedAtStore','inTransit','inProgress')
     ORDER BY COALESCE("acceptedAt", "createdAt") DESC
     LIMIT 1`,
    [riderId]
  );
  if (!order) return;

  const last = await queryOne<{ ts: Date }>(
    `SELECT timestamp as ts FROM "DeliveryTracking"
     WHERE "deliveryOrderId" = $1
     ORDER BY timestamp DESC
     LIMIT 1`,
    [order.id]
  );
  if (last?.ts) {
    const delta = Date.now() - new Date(last.ts).getTime();
    if (delta < MIN_INTERVAL_MS) return;
  }

  await query(
    `INSERT INTO "DeliveryTracking" (id, "deliveryOrderId", latitude, longitude)
     VALUES ($1, $2, $3, $4)`,
    [generateId(), order.id, latitude, longitude]
  );
}
