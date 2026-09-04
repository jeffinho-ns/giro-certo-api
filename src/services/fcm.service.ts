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

export type SendPushResult = {
  ok: boolean;
  tokenCount: number;
  successCount: number;
  failureCount: number;
  projectId?: string;
  usingFcmDedicatedApp: boolean;
  errors: string[];
};

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

function hasDedicatedFcmCredentials(): boolean {
  const hasIndividual =
    !!process.env.FIREBASE_FCM_PROJECT_ID &&
    !!process.env.FIREBASE_FCM_CLIENT_EMAIL &&
    !!process.env.FIREBASE_FCM_PRIVATE_KEY;
  return hasIndividual || !!process.env.FIREBASE_FCM_CREDENTIALS_JSON_BASE64;
}

/**
 * App Firebase usado só para Messaging (deve ser o mesmo projeto do GoogleService-Info / google-services).
 */
function ensureFcmApp(): { app: admin.app.App; usingFcmDedicatedApp: boolean; projectId?: string } {
  const existing = admin.apps.find((a) => a?.name === FCM_APP_NAME);
  if (existing) {
    return {
      app: existing,
      usingFcmDedicatedApp: true,
      projectId:
        process.env.FIREBASE_FCM_PROJECT_ID ||
        existing.options.credential && (existing.options as any).projectId,
    };
  }

  if (hasDedicatedFcmCredentials()) {
    const hasFcmIndividual =
      !!process.env.FIREBASE_FCM_PROJECT_ID &&
      !!process.env.FIREBASE_FCM_CLIENT_EMAIL &&
      !!process.env.FIREBASE_FCM_PRIVATE_KEY;

    let credential: admin.credential.Credential;
    let projectId = process.env.FIREBASE_FCM_PROJECT_ID;

    if (hasFcmIndividual) {
      credential = admin.credential.cert({
        projectId: process.env.FIREBASE_FCM_PROJECT_ID!,
        clientEmail: process.env.FIREBASE_FCM_CLIENT_EMAIL!,
        privateKey: normalizePrivateKey(process.env.FIREBASE_FCM_PRIVATE_KEY),
      });
    } else {
      const json = Buffer.from(
        process.env.FIREBASE_FCM_CREDENTIALS_JSON_BASE64!,
        'base64'
      ).toString('utf8');
      const parsed = JSON.parse(json);
      projectId = parsed.project_id || projectId;
      credential = admin.credential.cert(parsed);
    }

    const app = admin.initializeApp({ credential }, FCM_APP_NAME);
    console.log('[FCM] App dedicado inicializado projectId=', projectId);
    return { app, usingFcmDedicatedApp: true, projectId };
  }

  console.warn(
    '[FCM] FIREBASE_FCM_* não configurado — usando Firebase do Storage. ' +
      'Tokens do projeto giro-certo-72def falharão se o Storage for outro projeto.'
  );
  const app = ensureFirebaseApp();
  return {
    app,
    usingFcmDedicatedApp: false,
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
  };
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
    throw e;
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
 * Envia notificação push e devolve resultado (para diagnóstico e logs).
 * Fluxos de negócio podem ignorar o retorno; o endpoint de teste usa o detalhe.
 */
export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<SendPushResult> {
  const empty: SendPushResult = {
    ok: false,
    tokenCount: 0,
    successCount: 0,
    failureCount: 0,
    usingFcmDedicatedApp: hasDedicatedFcmCredentials(),
    errors: [],
  };

  try {
    const { app, usingFcmDedicatedApp, projectId } = ensureFcmApp();
    empty.usingFcmDedicatedApp = usingFcmDedicatedApp;
    empty.projectId = projectId;

    const tokens = await getFcmTokensForUser(userId);
    empty.tokenCount = tokens.length;
    if (tokens.length === 0) {
      empty.errors.push('Sem tokens FCM para o utilizador');
      console.warn('[FCM] Sem tokens para userId=', userId);
      return empty;
    }

    const messaging = admin.messaging(app);
    const cleanData: Record<string, string> = {};
    if (data) {
      for (const [key, value] of Object.entries(data)) {
        if (value != null && value !== '') {
          cleanData[key] = String(value);
        }
      }
    }

    const message: admin.messaging.MulticastMessage = {
      tokens,
      notification: { title, body },
      data: cleanData,
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
    empty.successCount = result.successCount;
    empty.failureCount = result.failureCount;
    empty.ok = result.failureCount === 0 && result.successCount > 0;

    result.responses.forEach((r, i) => {
      if (!r.success) {
        const msg = `${r.error?.code || 'error'}: ${r.error?.message || 'unknown'}`;
        empty.errors.push(msg);
        console.error(`[FCM] Falha token[${i}]:`, r.error?.code, r.error?.message);
      }
    });

    if (empty.ok) {
      console.log(
        `[FCM] OK userId=${userId} success=${result.successCount} type=${data?.type || 'generic'} project=${projectId}`
      );
    }
    return empty;
  } catch (e: any) {
    const msg = String(e?.code || e?.message || e);
    empty.errors.push(msg);
    console.error('[FCM] Erro ao enviar:', msg);
    return empty;
  }
}
