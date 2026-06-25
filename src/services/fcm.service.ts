/**
 * Envio de notificações push (FCM) para aparecer no telemóvel quando bloqueado.
 * Usa o mesmo projeto Firebase do storage; tokens guardados em UserFcmToken.
 */

import * as admin from 'firebase-admin';
import { ensureFirebaseApp } from './firebase-storage.service';
import { query, queryOne } from '../lib/db';
import { generateId } from '../utils/id';

export async function registerFcmToken(userId: string, token: string): Promise<void> {
  if (!token || typeof token !== 'string' || token.length < 10) return;
  try {
    const id = generateId();
    await query(
      `INSERT INTO "UserFcmToken" (id, "userId", token) VALUES ($1, $2, $3)
       ON CONFLICT ("userId", token) DO UPDATE SET "createdAt" = NOW()`,
      [id, userId, token]
    );
  } catch (_) {
    // Tabela UserFcmToken pode não existir ainda (executar scripts/migrate-user-fcm-tokens.sql)
  }
}

export async function getFcmTokensForUser(userId: string): Promise<string[]> {
  try {
    const rows = await query<{ token: string }>(
      'SELECT token FROM "UserFcmToken" WHERE "userId" = $1',
      [userId]
    );
    return (rows || []).map((r) => r.token).filter(Boolean);
  } catch (_) {
    return [];
  }
}

/**
 * Envia notificação push a um utilizador (todos os dispositivos registados).
 * Não lança erro se FCM falhar (ex.: token inválido) para não quebrar o fluxo.
 */
export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  try {
    ensureFirebaseApp();
    const tokens = await getFcmTokensForUser(userId);
    if (tokens.length === 0) return;

    const messaging = admin.messaging();
    const message: admin.messaging.MulticastMessage = {
      tokens,
      notification: { title, body },
      data: data || {},
      android: {
        priority: 'high',
        // Canal de alta importância criado no app (toca som/vibra mesmo com a tela bloqueada).
        notification: {
          channelId: 'giro_certo_alerts',
          sound: 'default',
          defaultSound: true,
          defaultVibrateTimings: true,
          notificationPriority: 'PRIORITY_MAX',
        },
      },
      apns: { payload: { aps: { sound: 'default' } } },
    };
    await messaging.sendEachForMulticast(message);
  } catch (_) {
    // Ignorar falhas FCM (token inválido, projeto sem FCM, etc.)
  }
}
