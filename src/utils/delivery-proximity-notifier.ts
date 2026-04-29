import { query, queryOne } from '../lib/db';
import { sendPushToUser } from '../services/fcm.service';

const notifiedOrders = new Set<string>();

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const earth = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(a)));
}

export async function maybeNotifyOrderEtaTwoMinutes(params: {
  orderId: string;
  riderId: string;
  riderLat: number;
  riderLng: number;
}): Promise<void> {
  if (notifiedOrders.has(params.orderId)) return;
  const order = await queryOne<{
    status: string;
    storeId: string;
    deliveryLatitude: number;
    deliveryLongitude: number;
  }>(
    `SELECT status::text AS status, "storeId", "deliveryLatitude", "deliveryLongitude"
     FROM "DeliveryOrder"
     WHERE id = $1`,
    [params.orderId]
  );
  if (!order || order.status !== 'inTransit') return;

  const distance = haversineMeters(
    params.riderLat,
    params.riderLng,
    order.deliveryLatitude,
    order.deliveryLongitude
  );
  if (distance > 1000) return;

  const storeUsers = await query<{ id: string }>(
    `SELECT id FROM "User" WHERE "partnerId" = $1`,
    [order.storeId]
  );
  const recipients = new Set<string>(storeUsers.map((u) => u.id));
  for (const userId of recipients) {
    await sendPushToUser(
      userId,
      'Entregador perto do destino',
      'O entregador está a cerca de 2 minutos do destino.',
      {
        type: 'delivery_eta',
        orderId: params.orderId,
      }
    );
  }
  notifiedOrders.add(params.orderId);
}
