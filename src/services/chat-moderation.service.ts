import { query, queryOne } from '../lib/db';
import { generateId } from '../utils/id';
import { ensureChatSchema } from './chat-schema';
import { assertChatAccess } from './chat.service';
import { ChatHttpError, parseReport, parseUserId } from './chat.types';
import { ChatPersonDto } from '../types';

export async function searchPeople(userId: string, rawQuery: string): Promise<ChatPersonDto[]> {
  await ensureChatSchema();
  const term = rawQuery.trim().slice(0, 80);
  if (!term) return [];
  const pattern = `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const rows = await query<{ id: string; name: string | null; photoUrl: string | null }>(
    `SELECT u.id, u.name, u."photoUrl"
     FROM "User" u
     WHERE u.id <> $1
       AND u.name ILIKE $2 ESCAPE '\\'
       AND NOT EXISTS (
         SELECT 1 FROM "ChatBlock" b
         WHERE (b."blockerId" = $1 AND b."blockedId" = u.id)
            OR (b."blockerId" = u.id AND b."blockedId" = $1)
       )
     ORDER BY u.name ASC
     LIMIT 20`,
    [userId, pattern]
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name ?? '',
    photoUrl: row.photoUrl,
  }));
}

export async function blockUser(blockerId: string, rawTargetId: unknown): Promise<void> {
  await ensureChatSchema();
  const blockedId = parseUserId(rawTargetId, 'userId');
  if (blockedId === blockerId) throw new ChatHttpError(400, 'Não podes bloquear-te a ti próprio.');
  const user = await queryOne<{ id: string }>('SELECT id FROM "User" WHERE id = $1', [blockedId]);
  if (!user) throw new ChatHttpError(404, 'Utilizador não encontrado');
  await query(
    `INSERT INTO "ChatBlock" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT ("blockerId", "blockedId") DO NOTHING`,
    [generateId(), blockerId, blockedId]
  );
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  await ensureChatSchema();
  await query(`DELETE FROM "ChatBlock" WHERE "blockerId" = $1 AND "blockedId" = $2`, [
    blockerId,
    blockedId,
  ]);
}

export async function createReport(reporterId: string, body: unknown): Promise<{ id: string }> {
  await ensureChatSchema();
  const input = parseReport(body);
  let targetUserId = input.userId;
  let chatId = input.chatId;

  if (input.messageId) {
    const message = await queryOne<{ chatId: string; senderId: string }>(
      `SELECT "chatId", "senderId" FROM "ChatMessage" WHERE id = $1`,
      [input.messageId]
    );
    if (!message) throw new ChatHttpError(404, 'Mensagem não encontrada');
    if (chatId && chatId !== message.chatId) {
      throw new ChatHttpError(400, 'A mensagem não pertence a esta conversa.');
    }
    chatId = message.chatId;
    if (!targetUserId) targetUserId = message.senderId;
  }

  if (chatId) await assertChatAccess(reporterId, chatId);

  if (targetUserId) {
    if (targetUserId === reporterId) {
      throw new ChatHttpError(400, 'Não podes denunciar-te a ti próprio.');
    }
    const user = await queryOne<{ id: string }>('SELECT id FROM "User" WHERE id = $1', [targetUserId]);
    if (!user) throw new ChatHttpError(404, 'Utilizador não encontrado');
  }

  const id = generateId();
  await query(
    `INSERT INTO "ChatReport"
       (id, "reporterId", "targetUserId", "chatId", "messageId", reason, "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [id, reporterId, targetUserId, chatId, input.messageId, input.reason]
  );
  return { id };
}
