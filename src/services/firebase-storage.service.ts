/**
 * Firebase Storage (Admin SDK) - Armazenamento de Imagens
 *
 * Usa o mesmo Firebase do vamos-comemorar, pasta "giro-certo".
 *
 * Variáveis de ambiente:
 * - FIREBASE_STORAGE_BUCKET (ex: agilizaiapp-img.firebasestorage.app)
 * - FIREBASE_ADMIN_PROJECT_ID
 * - FIREBASE_ADMIN_CLIENT_EMAIL
 * - FIREBASE_ADMIN_PRIVATE_KEY
 *
 * Fallback:
 * - FIREBASE_ADMIN_CREDENTIALS_JSON_BASE64
 */

import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

const FOLDER_PREFIX = 'giro-certo';

let app: admin.app.App | null = null;

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Env ausente: ${name}`);
  return v;
}

function normalizePrivateKey(value: string | undefined): string {
  if (!value) return '';
  let v = String(value).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v.replace(/\\n/g, '\n');
}

function init(): admin.app.App {
  if (app) return app;

  const bucket = requiredEnv('FIREBASE_STORAGE_BUCKET');

  let credential: admin.credential.Credential;
  const hasIndividualCreds =
    !!process.env.FIREBASE_ADMIN_PROJECT_ID &&
    !!process.env.FIREBASE_ADMIN_CLIENT_EMAIL &&
    !!process.env.FIREBASE_ADMIN_PRIVATE_KEY;

  if (hasIndividualCreds) {
    credential = admin.credential.cert({
      projectId: requiredEnv('FIREBASE_ADMIN_PROJECT_ID'),
      clientEmail: requiredEnv('FIREBASE_ADMIN_CLIENT_EMAIL'),
      privateKey: normalizePrivateKey(process.env.FIREBASE_ADMIN_PRIVATE_KEY),
    });
  } else if (process.env.FIREBASE_ADMIN_CREDENTIALS_JSON_BASE64) {
    const json = Buffer.from(
      process.env.FIREBASE_ADMIN_CREDENTIALS_JSON_BASE64,
      'base64'
    ).toString('utf8');
    credential = admin.credential.cert(JSON.parse(json));
  } else {
    throw new Error(
      'Credenciais Firebase Admin não configuradas. Use FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL e FIREBASE_ADMIN_PRIVATE_KEY.'
    );
  }

  if (admin.apps && admin.apps.length) {
    app = admin.app();
  } else {
    app = admin.initializeApp({ credential, storageBucket: bucket });
  }
  return app;
}

function getBucket() {
  init();
  return admin.storage().bucket();
}

function generateDownloadToken(): string {
  return crypto.randomUUID();
}

function buildDownloadUrl(bucketName: string, objectPath: string, token: string): string {
  const encodedPath = encodeURIComponent(objectPath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${token}`;
}

export function extractObjectPathFromFirebaseUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  if (!url.includes('firebasestorage.googleapis.com')) return null;
  const match = url.match(/\/o\/([^?]+)(?:\?|$)/);
  if (!match || !match[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export interface UploadResult {
  objectPath: string;
  url: string;
}

export async function uploadBuffer(params: {
  objectPath: string;
  buffer: Buffer;
  contentType?: string;
}): Promise<UploadResult> {
  const bucket = getBucket();
  const bucketName = bucket.name;
  const token = generateDownloadToken();

  const file = bucket.file(params.objectPath);
  await file.save(params.buffer, {
    resumable: false,
    metadata: {
      contentType: params.contentType || undefined,
      metadata: {
        firebaseStorageDownloadTokens: token,
      },
    },
  });

  return {
    objectPath: params.objectPath,
    url: buildDownloadUrl(bucketName, params.objectPath, token),
  };
}

export async function deleteObject(objectPath: string): Promise<void> {
  const bucket = getBucket();
  await bucket.file(objectPath).delete({ ignoreNotFound: true });
}

export async function deleteByUrlOrPath(value: string | null | undefined): Promise<void> {
  const objectPath = extractObjectPathFromFirebaseUrl(value) || value;
  if (!objectPath || typeof objectPath !== 'string') return;
  await deleteObject(objectPath);
}

/**
 * Gera path no Storage com pasta giro-certo/{subfolder}/{filename}
 */
export function buildObjectPath(subfolder: string, filename: string): string {
  const cleanSub = String(subfolder || 'general').replace(/^\/+/, '').replace(/\/+$/, '');
  const cleanName = String(filename || crypto.randomUUID()).replace(/^\/+/, '');
  return `${FOLDER_PREFIX}/${cleanSub}/${cleanName}`;
}
