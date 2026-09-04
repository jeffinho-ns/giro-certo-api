/**
 * Envio de notificações push (FCM).
 *
 * Importante: o app Flutter (giro-certo-72def) regista tokens FCM nesse projeto.
 * O Storage de imagens pode continuar no projeto agilizaiapp-img.
 * Por isso o FCM usa um Firebase App dedicado (FIREBASE_FCM_*), com fallback
 * para o Admin do storage só se as credenciais FCM não existirem.
 */

import * as admin from 'firebase-admin';
import { ensureFirebaseApp } from './firebase-storage.service';
import { query } from '../lib/db';
import { generateId } from '../utils/id';

const FCM_APP_NAME = 'giro-certo-fcm';

function normalizePrivateKey(value: string | undefined): string {
  if (!value) return '';
  let v = String(value).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  return v.replace(/\\n/g, '\n');
}

/**
 * App Firebase usado só para Messaging (deve ser o mesmo projeto do GoogleService-Info / google-services).
 */
function ensureFcmApp(): admin.app.App {
  const existing = admin.apps.find((a) => a?.name === FCM_APP_NAME);
  if (existing) return existing;

  const hasFcmIndividual =
    !!process.env.FIREBASE_FCM_PROJECT_ID &&
    !!process.env.FIREBASE_FCM_CLIENT_EMAIL &&
    !!process.env.FIREBASE_FCM_PRIVATE_KEY;

  if (hasFcmIndividual) {
    return admin.initializeApp(
      {
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_FCM_PROJECT_ID!,
          clientEmail: process.env.FIREBASE_FCM_CLIENT_EMAIL!,
          privateKey: normalizePrivateKey(process.env.FIREBASE_FCM_PRIVATE_KEY),
        }),
      },
      FCM_APP_NAME
    );
  }

  if (process.env.FIREBASE_FCM_CREDENTIALS_JSON_BASE64) {
    const json = Buffer.from(
      process.env.FIREBASE_FCM_CREDENTIALS_JSON_BASE64,
      'base64'
    ).toString('utf8');
    return admin.initializeApp(
      { credential: admin.credential.cert(JSON.parse(json)) },
      FCM_APP_NAME
    );
  }

  // Fallback: mesmo app do Storage (só funciona se o app Flutter usar esse projeto).
  console.warn(
    '[FCM] FIREBASE_FCM_* não configurado — usando Firebase do Storage. ' +
      'Tokens do projeto giro-certo-72def falharão se o Storage for outro projeto.'
  );
  return ensureFirebaseApp();
}

export async function registerFcmToken(userId: string, token: string): Promise<void> {
  if (!token || typeof token !== 'string' || token.length < 10) return;
  try {
    const id = generateId();
    await query(
      `INSERT INTO "UserFcmToken" (id, "userId", token) VALUES ($1, $2, $3)
       ON CONFLICT ("userId", token) DO UPDATE SET "createdAt" = NOW()`,
      [id, userId, token]
    );
  } catch (e) {
    console.warn('[FCM] Falha ao guardar token (tabela UserFcmToken?)', e);
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
    const app = ensureFcmApp();
    const tokens = await getFcmTokensForUser(userId);
    if (tokens.length === 0) {
      console.warn('[FCM] Sem tokens para userId=', userId);
      return;
    }

    const messaging = admin.messaging(app);
    const message: admin.messaging.MulticastMessage = {
      tokens,
      notification: { title, body },
      data: data || {},
      android: {
        priority: 'high',
        notification: {
          channelId: 'giro_certo_alerts',
          sound: 'default',
          defaultSound: true,
          defaultVibrateTimings: true,
          priority: 'max',
        },
      },
      apns: {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
        },
        payload: { aps: { sound: 'default' } },
      },
    };

    const result = await messaging.sendEachForMulticast(message);
    if (result.failureCount > 0) {
      result.responses.forEach((r, i) => {
        if (!r.success) {
          console.error(
            `[FCM] Falha token[${i}]:`,
            r.error?.code,
            r.error?.message
          );
        }
      });
    } else {
      console.log(
        `[FCM] OK userId=${userId} success=${result.successCount} type=${data?.type || 'generic'}`
      );
    }
  } catch (e: any) {
    console.error('[FCM] Erro ao enviar:', e?.code || e?.message || e);
  }
}
