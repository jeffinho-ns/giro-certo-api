import fs from 'fs/promises';
import path from 'path';
import { query, queryOne } from '../lib/db';
import { generateId } from '../utils/id';
import { buildObjectPath, uploadBuffer } from './firebase-storage.service';
import {
  assertChatAccess,
  emitToOtherMembers,
  isBlockedEither,
  otherParticipantId,
  peerLastReadAt,
  publishChatMessage,
} from './chat.service';
import { ChatHttpError, ChatIo, mapMessage, MessageRow, parseOutgoingMessage, previewFor, toIso } from './chat.types';
import { MessageDto } from '../types';

export const CHAT_MEDIA_MAX_BYTES = 15 * 1024 * 1024;

const AUDIO_MIME = new Set([
  'audio/aac',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/webm',
  'audio/m4a',
  'audio/x-m4a',
  'application/octet-stream',
]);

export interface UploadedChatFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

export function isAllowedChatMedia(mime: string): boolean {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  return base.startsWith('image/') || AUDIO_MIME.has(base);
}

export async function listMessages(
  userId: string,
  chatId: string
): Promise<{ messages: MessageDto[]; peerLastReadAt: string | null }> {
  const access = await assertChatAccess(userId, chatId);
  const rows = await query<MessageRow>(
    `SELECT m.id, m."senderId", u.name AS "senderName", m.text, m."createdAt", m."type",
            m."mediaUrl", m."mediaDurationMs", m."replyToId",
            m.latitude, m.longitude, m."locationLabel", m."deletedAt",
            r.text AS "replyText", r."type" AS "replyType", r."deletedAt" AS "replyDeletedAt"
     FROM "ChatMessage" m
     JOIN "User" u ON u.id = m."senderId"
     LEFT JOIN "ChatMessage" r ON r.id = m."replyToId"
     WHERE m."chatId" = $1
     ORDER BY m."createdAt" ASC`,
    [chatId]
  );
  return {
    messages: rows.map((row) => mapMessage(row, userId)),
    peerLastReadAt: await peerLastReadAt(access, userId),
  };
}

export async function sendMessage(
  userId: string,
  chatId: string,
  body: unknown,
  io: ChatIo | null
): Promise<MessageDto> {
  const access = await assertChatAccess(userId, chatId);
  const input = parseOutgoingMessage(body);
  if (access.type === 'private') {
    const otherId = otherParticipantId(access, userId);
    if (!otherId) throw new ChatHttpError(400, 'Conversa inválida');
    if (await isBlockedEither(userId, otherId)) {
      throw new ChatHttpError(403, 'Não é possível enviar mensagens para este utilizador.');
    }
  }

  let replyPreview: string | null = null;
  if (input.replyToId) {
    const reply = await queryOne<{ type: string; text: string; deletedAt: Date | null }>(
      `SELECT "type", text, "deletedAt" FROM "ChatMessage" WHERE id = $1 AND "chatId" = $2`,
      [input.replyToId, chatId]
    );
    if (!reply) throw new ChatHttpError(400, 'Mensagem citada não encontrada');
    replyPreview = reply.deletedAt ? '' : previewFor(reply.type, reply.text ?? '');
  }

  const user = await queryOne<{ name: string | null }>('SELECT name FROM "User" WHERE id = $1', [userId]);
  const id = generateId();
  const inserted = await queryOne<{ createdAt: Date }>(
    `INSERT INTO "ChatMessage" (
       id, "chatId", "senderId", text, "type", "mediaUrl", "mediaDurationMs", "replyToId",
       latitude, longitude, "locationLabel", "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW()
     )
     RETURNING "createdAt"`,
    [
      id,
      chatId,
      userId,
      input.text,
      input.type,
      input.mediaUrl,
      input.mediaDurationMs,
      input.replyToId,
      input.latitude,
      input.longitude,
      input.locationLabel,
    ]
  );
  const message: MessageDto = {
    id,
    senderId: userId,
    senderName: user?.name ?? 'Utilizador',
    text: input.text,
    createdAt: toIso(inserted?.createdAt) ?? new Date().toISOString(),
    isFromMe: true,
    type: input.type,
    mediaUrl: input.mediaUrl,
    mediaDurationMs: input.mediaDurationMs,
    replyToId: input.replyToId,
    replyPreview,
    latitude: input.latitude,
    longitude: input.longitude,
    locationLabel: input.locationLabel,
    deleted: false,
  };
  await publishChatMessage(io, chatId, userId, message, previewFor(input.type, input.text));
  return message;
}

export async function deleteMessage(
  userId: string,
  chatId: string,
  messageId: string,
  io: ChatIo | null
): Promise<void> {
  await assertChatAccess(userId, chatId);
  const existing = await queryOne<{ senderId: string; deletedAt: Date | null }>(
    `SELECT "senderId", "deletedAt" FROM "ChatMessage" WHERE id = $1 AND "chatId" = $2`,
    [messageId, chatId]
  );
  if (!existing) throw new ChatHttpError(404, 'Mensagem não encontrada');
  if (existing.senderId !== userId) throw new ChatHttpError(403, 'Só podes apagar as tuas mensagens.');
  if (existing.deletedAt) return;

  await query(
    `UPDATE "ChatMessage" SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`,
    [messageId]
  );
  await query(
    `UPDATE "ChatConversation"
     SET "lastMessagePreview" = 'Mensagem apagada', "updatedAt" = NOW()
     WHERE id = $1
       AND (
         SELECT id FROM "ChatMessage"
         WHERE "chatId" = $1
         ORDER BY "createdAt" DESC, id DESC
         LIMIT 1
       ) = $2`,
    [chatId, messageId]
  );
  await emitToOtherMembers(io, chatId, userId, 'chat:message-deleted', { chatId, messageId });
}

export async function storeChatMedia(file: UploadedChatFile): Promise<string> {
  if (!file?.buffer || file.size <= 0) throw new ChatHttpError(400, 'Nenhum ficheiro enviado');
  if (file.size > CHAT_MEDIA_MAX_BYTES) {
    throw new ChatHttpError(413, 'Ficheiro demasiado grande (máx. 15MB).');
  }
  if (!isAllowedChatMedia(file.mimetype || '')) {
    throw new ChatHttpError(400, 'Tipo de ficheiro não suportado');
  }
  const filename = `${generateId()}${safeExt(file.originalname, file.mimetype)}`;
  if (isFirebaseConfigured()) {
    try {
      const uploaded = await uploadBuffer({
        objectPath: buildObjectPath('chat', filename),
        buffer: file.buffer,
        contentType: file.mimetype,
      });
      return uploaded.url;
    } catch (error: unknown) {
      console.error(
        '[chat] Firebase upload falhou; fallback local:',
        error instanceof Error ? error.message : error
      );
    }
  }
  const dir = path.join(process.cwd(), 'uploads');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), file.buffer);
  const base = (process.env.API_URL || 'https://giro-certo-api.onrender.com').replace(/\/+$/, '');
  return `${base}/uploads/${filename}`;
}

function isFirebaseConfigured(): boolean {
  return !!(
    process.env.FIREBASE_STORAGE_BUCKET &&
    (process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.FIREBASE_ADMIN_CREDENTIALS_JSON_BASE64)
  );
}

function safeExt(originalName: string, mime: string): string {
  const allowed = new Set([
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.webp',
    '.heic',
    '.heif',
    '.mp3',
    '.m4a',
    '.aac',
    '.wav',
    '.webm',
    '.mp4',
    '.bin',
  ]);
  const raw = path.extname(originalName || '').toLowerCase();
  if (allowed.has(raw)) return raw;
  const base = (mime || '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (base === 'audio/mpeg') return '.mp3';
  if (base === 'audio/mp4' || base === 'audio/m4a' || base === 'audio/x-m4a') return '.m4a';
  if (base === 'audio/aac') return '.aac';
  if (base === 'audio/wav') return '.wav';
  if (base === 'audio/webm') return '.webm';
  if (base === 'image/jpeg') return '.jpg';
  if (base === 'image/png') return '.png';
  if (base === 'image/webp') return '.webp';
  if (base === 'image/gif') return '.gif';
  if (base.startsWith('image/')) return '.img';
  return '.bin';
}
