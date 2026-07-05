import { execute, queryOne } from '../lib/db';
import { DeliveryStatus, StoreOrderStatus } from '../types';
import { ssePublishStoreOrder } from '../utils/socket-events';

/**
 * Espelha o status da DeliveryOrder no StoreOrder vinculado (vitrine).
 * Só avança status "para frente" (não regride paid/accepted).
 */
export async function syncStoreOrderFromDelivery(
  deliveryOrderId: string,
  deliveryStatus: string,
  storeOrderId?: string | null
): Promise<void> {
  if (!storeOrderId) return;

  let next: StoreOrderStatus | null = null;
  let setCompleted = false;
  let setCancelled = false;

  switch (deliveryStatus) {
    case DeliveryStatus.accepted:
    case DeliveryStatus.arrivedAtStore:
    case DeliveryStatus.inTransit:
    case DeliveryStatus.inProgress:
    case DeliveryStatus.arrivedAtDestination:
      next = StoreOrderStatus.in_delivery;
      break;
    case DeliveryStatus.completed:
      next = StoreOrderStatus.completed;
      setCompleted = true;
      break;
    case DeliveryStatus.cancelled:
      next = StoreOrderStatus.cancelled;
      setCancelled = true;
      break;
    default:
      return;
  }

  const sets = [`status = $1`, `"updatedAt" = NOW()`];
  const vals: unknown[] = [next];
  let idx = 2;

  if (setCompleted) {
    sets.push(`"completedAt" = COALESCE("completedAt", NOW())`);
  }
  if (setCancelled) {
    sets.push(`"cancelledAt" = COALESCE("cancelledAt", NOW())`);
  }

  vals.push(storeOrderId, deliveryOrderId);
  await execute(
    `UPDATE "StoreOrder"
     SET ${sets.join(', ')}
     WHERE id = $${idx++}
       AND "deliveryOrderId" = $${idx}
       AND status NOT IN ('completed', 'cancelled', 'rejected')`,
    vals
  );

  const row = await queryOne<{ trackingToken: string; status: string }>(
    `SELECT "trackingToken", status FROM "StoreOrder" WHERE id = $1`,
    [storeOrderId]
  );
  if (row?.trackingToken && next) {
    ssePublishStoreOrder(row.trackingToken, 'store_order:update', {
      status: row.status,
      deliveryOrderId,
      deliveryStatus,
    });
  }
}
