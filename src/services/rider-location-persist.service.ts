import type { Application } from 'express';
import { query } from '../lib/db';
import { recordDeliveryTrackingIfDue } from '../utils/delivery-tracking-writer';
import { recordDeliveryRouteHistoryPointIfActive } from '../utils/delivery-route-history-writer';
import { ioEmitToRoom } from '../utils/socket-events';
import { shouldEmitRiderLocationSocket, touchRiderLocationSocketThrottle } from '../utils/rider-socket-throttle';

/** Evita UPDATE/INSERT e broadcasts em rajada (cliente mal configurado ou flood). */
const lastSocketPersistMs = new Map<string, number>();
const SOCKET_PERSIST_MIN_MS = 4000;
/** Limite de “checkpoint” imediato (evita abuso do flag). */
const lastCheckpointPersistMs = new Map<string, number>();
const CHECKPOINT_PERSIST_MIN_MS = 2500;

/**
 * Persiste localização vinda do Socket (`rider:location`): User, tracking, histórico (throttle no writer)
 * e reemite para salas da torre com estrangulamento, salvo [forceImmediate] (marco da corrida).
 */
export async function persistRiderLocationFromSocketEvent(
  app: Application,
  params: {
    userId: string;
    latitude: number;
    longitude: number;
    orderId: string | null;
    status?: string | null;
    /** Ex.: após PUT de marco no app — ignora throttle longo, com limite curto próprio. */
    forceImmediate?: boolean;
  }
): Promise<void> {
  const now = Date.now();
  if (params.forceImmediate) {
    const prevCk = lastCheckpointPersistMs.get(params.userId) ?? 0;
    if (now - prevCk < CHECKPOINT_PERSIST_MIN_MS) {
      return;
    }
    lastCheckpointPersistMs.set(params.userId, now);
  } else {
    const prev = lastSocketPersistMs.get(params.userId) ?? 0;
    if (now - prev < SOCKET_PERSIST_MIN_MS) {
      return;
    }
  }
  lastSocketPersistMs.set(params.userId, now);

  await query(
    `UPDATE "User"
     SET "currentLat" = $1,
         "currentLng" = $2,
         "isOnline" = true,
         "lastLocationUpdate" = NOW(),
         "updatedAt" = NOW()
     WHERE id = $3`,
    [params.latitude, params.longitude, params.userId]
  );

  try {
    await recordDeliveryTrackingIfDue(params.userId, params.latitude, params.longitude);
  } catch {
    // já logado em delivery-tracking-writer / callers
  }

  try {
    await recordDeliveryRouteHistoryPointIfActive({
      riderId: params.userId,
      latitude: params.latitude,
      longitude: params.longitude,
    });
  } catch {
    // idem
  }

  if (
    params.orderId &&
    (params.forceImmediate ||
      shouldEmitRiderLocationSocket(params.userId, {
        navigationActive: true,
      }))
  ) {
    const payload = {
      userId: params.userId,
      lat: params.latitude,
      lng: params.longitude,
      orderId: params.orderId,
      status: params.status ?? undefined,
      at: now,
    };
    ioEmitToRoom(app, `order:${params.orderId}`, 'rider:location:update', payload);
    ioEmitToRoom(app, 'role:admin', 'rider:location:update', payload);
    if (params.forceImmediate) {
      touchRiderLocationSocketThrottle(params.userId);
    }
  }
}
