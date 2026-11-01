import { query, queryOne } from '../lib/db';
import { generateId } from '../utils/id';
import { sendPushToUser } from './fcm.service';
import { ensureChatSchema, withDbTransaction } from './chat-schema';
import {
  ChatAccess,
  ChatHttpError,
  ChatIo,
  ConversationRow,
  mapConversation,
  previewFor,
  toIso,
  toNumber,
  isMemberRole,
  isUniqueViolation,
} from './chat.types';
import { ChatParticipantDto, ChatSettingsDto, ConversationDto, MessageDto } from '../types';

const SUPPORT_INTRO =
  'Olá! Este é o canal de suporte técnico. Conte o problema que você encontrou.';

const UNREAD_COUNT_SQL = `
  (
    SELECT COUNT(*)::int
    FROM "ChatMessage" m
    WHERE m."chatId" = c.id
      AND m."deletedAt" IS NULL
      AND m."senderId" <> $1
      AND COALESCE(m."type", 'text') <> 'system'
      AND (pref."lastReadAt" IS NULL OR m."createdAt" > pref."lastReadAt")
  )`;

const STATE_FILTERS_SQL = `
  AND (
    $2::text = 'any'
    OR ($2::text = 'true' AND pref."archivedAt" IS NOT NULL)
    OR ($2::text = 'false' AND pref."archivedAt" IS NULL)
  )
  AND ($4::text IS NULL OR c.id = $4::text)
  AND (
    $5::boolean = true
    OR NOT EXISTS (
      SELECT 1 FROM "ChatConversationHidden" h
      WHERE h."chatId" = c.id AND h."userId" = $1
    )
  )`;

const CONVERSATION_SQL = `
  SELECT * FROM (
    SELECT
      c.id,
      c."type" AS "type",
      c.title,
      c."imageUrl" AS "imageUrl",
      c."lastMessagePreview" AS "lastMessagePreview",
      c."lastMessageAt" AS "lastMessageAt",
      c."eventId" AS "eventId",
      c."meetupLabel" AS "meetupLabel",
      c."meetupLat" AS "meetupLat",
      c."meetupLng" AS "meetupLng",
      c."meetupAt" AS "meetupAt",
      other.id AS "otherId",
      other.name AS "otherName",
      other."photoUrl" AS "otherPhotoUrl",
      NULL::text AS "myRole",
      (pref."pinnedAt" IS NOT NULL) AS pinned,
      (pref."archivedAt" IS NOT NULL) AS archived,
      COALESCE(mute.muted, false) AS muted,
      ${UNREAD_COUNT_SQL} AS "unreadCount"
    FROM "ChatConversation" c
    JOIN "User" other
      ON other.id = CASE
        WHEN c."participant1Id" = $1 THEN c."participant2Id"
        ELSE c."participant1Id"
      END
    LEFT JOIN "ChatUserPref" pref
      ON pref."chatId" = c.id AND pref."userId" = $1
    LEFT JOIN "ChatMute" mute
      ON mute."chatId" = c.id AND mute."userId" = $1
    WHERE c."type" = 'private'
      AND ($3::text = 'all' OR $3::text = 'private')
      AND (c."participant1Id" = $1 OR c."participant2Id" = $1)
      ${STATE_FILTERS_SQL}
    UNION ALL
    SELECT
      c.id,
      c."type" AS "type",
      c.title,
      c."imageUrl" AS "imageUrl",
      c."lastMessagePreview" AS "lastMessagePreview",
      c."lastMessageAt" AS "lastMessageAt",
      c."eventId" AS "eventId",
      c."meetupLabel" AS "meetupLabel",
      c."meetupLat" AS "meetupLat",
      c."meetupLng" AS "meetupLng",
      c."meetupAt" AS "meetupAt",
      NULL::text AS "otherId",
      NULL::text AS "otherName",
      NULL::text AS "otherPhotoUrl",
      mem.role AS "myRole",
      (pref."pinnedAt" IS NOT NULL) AS pinned,
      (pref."archivedAt" IS NOT NULL) AS archived,
      COALESCE(mute.muted, false) AS muted,
      ${UNREAD_COUNT_SQL} AS "unreadCount"
    FROM "ChatConversation" c
    JOIN "ChatMember" mem
      ON mem."chatId" = c.id AND mem."userId" = $1 AND mem."leftAt" IS NULL
    LEFT JOIN "ChatUserPref" pref
      ON pref."chatId" = c.id AND pref."userId" = $1
    LEFT JOIN "ChatMute" mute
      ON mute."chatId" = c.id AND mute."userId" = $1
    WHERE c."type" = 'group'
      AND ($3::text = 'all' OR $3::text = 'group')
      ${STATE_FILTERS_SQL}
  ) conversations
  ORDER BY conversations.pinned DESC, conversations."lastMessageAt" DESC NULLS LAST
`;

interface ConversationQuery {
  userId: string;
  archiveMode: 'true' | 'false' | 'any';
  type: 'private' | 'group' | 'all';
  chatId: string | null;
  includeHidden: boolean;
}

function conversationParams(input: ConversationQuery): [string, string, string, string | null, boolean] {
  return [input.userId, input.archiveMode, input.type, input.chatId, input.includeHidden];
}

export function otherParticipantId(access: ChatAccess, userId: string): string | null {
  if (access.type === 'group') return null;
  if (access.participant1Id === userId) return access.participant2Id;
  if (access.participant2Id === userId) return access.participant1Id;
  return null;
}

export async function listOtherParticipantIds(chatId: string, userId: string): Promise<string[] | null> {
  await ensureChatSchema();
  const conv = await queryOne<{
    type: string;
    participant1Id: string | null;
    participant2Id: string | null;
  }>(
    `SELECT "type", "participant1Id", "participant2Id" FROM "ChatConversation" WHERE id = $1`,
    [chatId]
  );
  if (!conv) return null;
  if (conv.type === 'group') {
    const self = await queryOne<{ id: string }>(
      `SELECT id FROM "ChatMember" WHERE "chatId" = $1 AND "userId" = $2 AND "leftAt" IS NULL`,
      [chatId, userId]
    );
    if (!self) return null;
    const rows = await query<{ userId: string }>(
      `SELECT "userId" FROM "ChatMember" WHERE "chatId" = $1 AND "leftAt" IS NULL AND "userId" <> $2`,
      [chatId, userId]
    );
    return rows.map((row) => row.userId);
  }
  const participants = [conv.participant1Id, conv.participant2Id].filter(
    (id): id is string => typeof id === 'string' && id.length > 0
  );
  if (!participants.includes(userId)) return null;
  return participants.filter((id) => id !== userId);
}

export async function assertChatAccess(userId: string, chatId: string): Promise<ChatAccess> {
  await ensureChatSchema();
  const conv = await queryOne<{
    id: string;
    type: string;
    title: string | null;
    imageUrl: string | null;
    participant1Id: string | null;
    participant2Id: string | null;
    eventId: string | null;
    meetupLabel: string | null;
    meetupLat: number | null;
    meetupLng: number | null;
    meetupAt: Date | null;
  }>(
    `SELECT id, "type", title, "imageUrl", "participant1Id", "participant2Id",
            "eventId", "meetupLabel", "meetupLat", "meetupLng", "meetupAt"
     FROM "ChatConversation" WHERE id = $1`,
    [chatId]
  );
  if (!conv) throw new ChatHttpError(404, 'Conversa não encontrada');

  const base: ChatAccess = {
    id: conv.id,
    type: conv.type === 'group' ? 'group' : 'private',
    title: conv.title,
    imageUrl: conv.imageUrl,
    participant1Id: conv.participant1Id,
    participant2Id: conv.participant2Id,
    eventId: conv.eventId,
    meetupLabel: conv.meetupLabel,
    meetupLat: toNumber(conv.meetupLat),
    meetupLng: toNumber(conv.meetupLng),
    meetupAt: conv.meetupAt,
    myRole: null,
  };

  if (conv.type === 'group') {
    const member = await queryOne<{ role: string }>(
      `SELECT role FROM "ChatMember" WHERE "chatId" = $1 AND "userId" = $2 AND "leftAt" IS NULL`,
      [chatId, userId]
    );
    if (!member || !isMemberRole(member.role)) {
      throw new ChatHttpError(403, 'Sem acesso a esta conversa');
    }
    return { ...base, type: 'group', myRole: member.role };
  }

  if (conv.participant1Id !== userId && conv.participant2Id !== userId) {
    throw new ChatHttpError(403, 'Sem acesso a esta conversa');
  }
  return { ...base, type: 'private', myRole: null };
}

export async function isBlockedEither(a: string, b: string): Promise<boolean> {
  await ensureChatSchema();
  const row = await queryOne<{ blocked: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM "ChatBlock"
       WHERE ("blockerId" = $1 AND "blockedId" = $2)
          OR ("blockerId" = $2 AND "blockedId" = $1)
     ) AS blocked`,
    [a, b]
  );
  return row?.blocked === true;
}

export async function peerLastReadAt(access: ChatAccess, userId: string): Promise<string | null> {
  if (access.type !== 'private') return null;
  const otherId = otherParticipantId(access, userId);
  if (!otherId) return null;
  const row = await queryOne<{ lastReadAt: Date | null }>(
    `SELECT "lastReadAt" FROM "ChatUserPref" WHERE "chatId" = $1 AND "userId" = $2`,
    [access.id, otherId]
  );
  return toIso(row?.lastReadAt ?? null);
}

export async function unhideForUser(chatId: string, userId: string): Promise<void> {
  await query(`DELETE FROM "ChatConversationHidden" WHERE "chatId" = $1 AND "userId" = $2`, [
    chatId,
    userId,
  ]);
}

export async function listConversations(
  userId: string,
  type: 'private' | 'group' | 'all',
  archived: boolean
): Promise<ConversationDto[]> {
  await ensureChatSchema();
  const rows = await query<ConversationRow>(
    CONVERSATION_SQL,
    conversationParams({
      userId,
      archiveMode: archived ? 'true' : 'false',
      type,
      chatId: null,
      includeHidden: false,
    })
  );
  return rows.map(mapConversation);
}

export async function loadConversationDto(userId: string, chatId: string): Promise<ConversationDto> {
  await ensureChatSchema();
  const row = await queryOne<ConversationRow>(
    CONVERSATION_SQL,
    conversationParams({
      userId,
      archiveMode: 'any',
      type: 'all',
      chatId,
      includeHidden: true,
    })
  );
  if (row) return mapConversation(row);
  await assertChatAccess(userId, chatId);
  throw new ChatHttpError(500, 'Não foi possível carregar a conversa');
}

export async function openPrivateChat(
  userId: string,
  recipientId: string
): Promise<{ conversation: ConversationDto; created: boolean }> {
  await ensureChatSchema();
  if (!recipientId || recipientId === userId) {
    throw new ChatHttpError(400, 'recipientId inválido');
  }
  const recipient = await queryOne<{ id: string }>('SELECT id FROM "User" WHERE id = $1', [recipientId]);
  if (!recipient) throw new ChatHttpError(404, 'Utilizador não encontrado');
  if (await isBlockedEither(userId, recipientId)) {
    throw new ChatHttpError(403, 'Não é possível conversar com este utilizador.');
  }

  const [p1, p2] = [userId, recipientId].sort();
  const found = await findPrivateChat(p1, p2);
  let chatId = found;
  let created = false;
  if (!chatId) {
    chatId = generateId();
    try {
      await query(
        `INSERT INTO "ChatConversation"
           (id, "participant1Id", "participant2Id", "type", "createdById", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'private', $4, NOW(), NOW())`,
        [chatId, p1, p2, userId]
      );
      created = true;
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) throw error;
      const again = await findPrivateChat(p1, p2);
      if (!again) throw error;
      chatId = again;
      created = false;
    }
  }

  await unhideForUser(chatId, userId);
  return { conversation: await loadConversationDto(userId, chatId), created };
}

export async function startSupportChat(userId: string): Promise<{
  conversation: ConversationDto;
  supportAgent: { id: string; name: string };
}> {
  await ensureChatSchema();
  const supportUser = await queryOne<{ id: string; name: string }>(
    `SELECT id, name
     FROM "User"
     WHERE role IN ('ADMIN', 'MODERATOR')
       AND id <> $1
     ORDER BY "updatedAt" DESC
     LIMIT 1`,
    [userId]
  );
  if (!supportUser) {
    throw new ChatHttpError(404, 'Equipe de suporte indisponível no momento.');
  }

  const [p1, p2] = [userId, supportUser.id].sort();
  let chatId = await findPrivateChat(p1, p2);
  if (!chatId) {
    chatId = generateId();
    try {
      const newChatId = chatId;
      await withDbTransaction(async (client) => {
        await client.query(
          `INSERT INTO "ChatConversation"
             (id, "participant1Id", "participant2Id", "type", "createdById", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, 'private', $4, NOW(), NOW())`,
          [newChatId, p1, p2, userId]
        );
        await client.query(
          `INSERT INTO "ChatMessage" (id, "chatId", "senderId", text, "type", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, 'text', NOW(), NOW())`,
          [generateId(), newChatId, supportUser.id, SUPPORT_INTRO]
        );
        await client.query(
          `UPDATE "ChatConversation"
           SET "lastMessageAt" = NOW(), "lastMessagePreview" = $2, "updatedAt" = NOW()
           WHERE id = $1`,
          [newChatId, SUPPORT_INTRO]
        );
      });
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) throw error;
      const again = await findPrivateChat(p1, p2);
      if (!again) throw error;
      chatId = again;
    }
  }

  const conversation = await loadConversationDto(userId, chatId);
  return {
    conversation: { ...conversation, title: `Suporte técnico • ${supportUser.name}` },
    supportAgent: { id: supportUser.id, name: supportUser.name },
  };
}

export async function getSettings(
  userId: string,
  chatId: string,
  io: ChatIo | null = null
): Promise<ChatSettingsDto> {
  const access = await assertChatAccess(userId, chatId);
  await maybeAnnounceRideEnded(access, userId, io);
  const participants =
    access.type === 'group' ? await groupParticipants(chatId) : await privateParticipants(access);
  const mute = await queryOne<{ muted: boolean }>(
    `SELECT muted FROM "ChatMute" WHERE "chatId" = $1 AND "userId" = $2`,
    [chatId, userId]
  );
  const title =
    access.type === 'group' ? access.title?.trim() || 'Grupo' : await privateTitle(access, userId);
  return {
    chat: {
      id: access.id,
      isGroup: access.type === 'group',
      title,
      myRole: access.myRole,
      eventId: access.eventId,
      meetupLabel: access.meetupLabel,
      meetupLat: access.meetupLat,
      meetupLng: access.meetupLng,
      meetupAt: toIso(access.meetupAt),
    },
    participants,
    muted: mute?.muted === true,
    peerLastReadAt: await peerLastReadAt(access, userId),
  };
}

/** Uma mensagem system suave quando o horário do rolê já passou. */
async function maybeAnnounceRideEnded(
  access: ChatAccess,
  actorId: string,
  io: ChatIo | null
): Promise<void> {
  if (access.type !== 'group' || !access.meetupAt) return;
  const endedAt = access.meetupAt instanceof Date ? access.meetupAt : new Date(access.meetupAt);
  if (Number.isNaN(endedAt.getTime()) || endedAt.getTime() > Date.now()) return;
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM "ChatMessage"
     WHERE "chatId" = $1 AND "type" = 'system' AND text = $2
     LIMIT 1`,
    [access.id, 'Rolê encerrado.']
  );
  if (existing) return;
  await publishSystemMessage(io, access.id, actorId, 'Rolê encerrado.');
}

export async function setMuted(userId: string, chatId: string, muted: boolean): Promise<boolean> {
  await assertChatAccess(userId, chatId);
  await query(
    `INSERT INTO "ChatMute" (id, "chatId", "userId", muted, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT ("chatId", "userId")
     DO UPDATE SET muted = EXCLUDED.muted, "updatedAt" = NOW()`,
    [generateId(), chatId, userId, muted]
  );
  return muted;
}

export async function setPinned(userId: string, chatId: string, pinned: boolean): Promise<boolean> {
  await assertChatAccess(userId, chatId);
  await query(
    `INSERT INTO "ChatUserPref" (id, "chatId", "userId", "pinnedAt")
     VALUES ($1, $2, $3, CASE WHEN $4::boolean THEN NOW() ELSE NULL END)
     ON CONFLICT ("chatId", "userId")
     DO UPDATE SET "pinnedAt" = CASE WHEN $4::boolean THEN NOW() ELSE NULL END`,
    [generateId(), chatId, userId, pinned]
  );
  return pinned;
}

export async function setArchived(userId: string, chatId: string, archived: boolean): Promise<boolean> {
  await assertChatAccess(userId, chatId);
  await query(
    `INSERT INTO "ChatUserPref" (id, "chatId", "userId", "archivedAt")
     VALUES ($1, $2, $3, CASE WHEN $4::boolean THEN NOW() ELSE NULL END)
     ON CONFLICT ("chatId", "userId")
     DO UPDATE SET "archivedAt" = CASE WHEN $4::boolean THEN NOW() ELSE NULL END`,
    [generateId(), chatId, userId, archived]
  );
  return archived;
}

export async function markRead(userId: string, chatId: string, io: ChatIo | null): Promise<string> {
  const access = await assertChatAccess(userId, chatId);
  const row = await queryOne<{ lastReadAt: Date }>(
    `INSERT INTO "ChatUserPref" (id, "chatId", "userId", "lastReadAt")
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT ("chatId", "userId")
     DO UPDATE SET "lastReadAt" = NOW()
     RETURNING "lastReadAt"`,
    [generateId(), chatId, userId]
  );
  const lastReadAt = toIso(row?.lastReadAt) ?? new Date().toISOString();
  if (access.type === 'private' && io) {
    const otherId = otherParticipantId(access, userId);
    if (otherId) io.to(`user:${otherId}`).emit('chat:read', { chatId, userId, lastReadAt });
  }
  return lastReadAt;
}

export async function hideConversation(userId: string, chatId: string): Promise<void> {
  await assertChatAccess(userId, chatId);
  await query(
    `INSERT INTO "ChatConversationHidden" (id, "chatId", "userId", "hiddenAt")
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT ("chatId", "userId")
     DO UPDATE SET "hiddenAt" = NOW()`,
    [generateId(), chatId, userId]
  );
}

export async function publishChatMessage(
  io: ChatIo | null,
  chatId: string,
  senderId: string,
  message: MessageDto,
  preview: string,
  options?: { push?: boolean }
): Promise<void> {
  await query(
    `UPDATE "ChatConversation"
     SET "lastMessageAt" = NOW(), "lastMessagePreview" = $2, "updatedAt" = NOW()
     WHERE id = $1`,
    [chatId, preview]
  );
  await query(`DELETE FROM "ChatConversationHidden" WHERE "chatId" = $1`, [chatId]);

  const recipients = (await listOtherParticipantIds(chatId, senderId)) ?? [];
  if (recipients.length === 0) return;

  if (io) {
    const payload = { chatId, message: { ...message, isFromMe: false } };
    for (const id of recipients) io.to(`user:${id}`).emit('chat:message', payload);
  }
  if (options?.push === false) return;

  const mutedRows = await query<{ userId: string }>(
    `SELECT "userId" FROM "ChatMute"
     WHERE "chatId" = $1 AND muted = true AND "userId" = ANY($2::text[])`,
    [chatId, recipients]
  );
  const muted = new Set(mutedRows.map((row) => row.userId));
  await Promise.all(
    recipients
      .filter((id) => !muted.has(id))
      .map(async (id) => {
        try {
          const body = `${message.senderName}: ${preview}`.slice(0, 180);
          await sendPushToUser(id, 'Nova mensagem', body, { type: 'chat', chatId });
        } catch (error: unknown) {
          console.warn('[chat] push', error instanceof Error ? error.message : error);
        }
      })
  );
}

export async function publishSystemMessage(
  io: ChatIo | null,
  chatId: string,
  actorId: string,
  text: string
): Promise<MessageDto> {
  const user = await queryOne<{ name: string }>('SELECT name FROM "User" WHERE id = $1', [actorId]);
  const id = generateId();
  const inserted = await queryOne<{ createdAt: Date }>(
    `INSERT INTO "ChatMessage" (id, "chatId", "senderId", text, "type", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 'system', NOW(), NOW())
     RETURNING "createdAt"`,
    [id, chatId, actorId, text]
  );
  const message: MessageDto = {
    id,
    senderId: actorId,
    senderName: user?.name ?? 'Utilizador',
    text,
    createdAt: toIso(inserted?.createdAt) ?? new Date().toISOString(),
    isFromMe: true,
    type: 'system',
    mediaUrl: null,
    mediaDurationMs: null,
    replyToId: null,
    replyPreview: null,
    latitude: null,
    longitude: null,
    locationLabel: null,
    deleted: false,
  };
  await publishChatMessage(io, chatId, actorId, message, previewFor('system', text), { push: false });
  return message;
}

export async function emitToOtherMembers(
  io: ChatIo | null,
  chatId: string,
  userId: string,
  event: string,
  payload: unknown
): Promise<void> {
  if (!io) return;
  const recipients = await listOtherParticipantIds(chatId, userId);
  if (!recipients) return;
  for (const id of recipients) io.to(`user:${id}`).emit(event, payload);
}

export async function relayChatTyping(
  io: ChatIo,
  userId: string,
  chatId: string,
  isTyping: boolean
): Promise<void> {
  const recipients = await listOtherParticipantIds(chatId, userId);
  if (!recipients || recipients.length === 0) return;
  const user = await queryOne<{ name: string }>('SELECT name FROM "User" WHERE id = $1', [userId]);
  const payload = {
    chatId,
    userId,
    userName: user?.name ?? 'Utilizador',
    isTyping,
  };
  for (const id of recipients) io.to(`user:${id}`).emit('chat:typing', payload);
}

async function findPrivateChat(p1: string, p2: string): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM "ChatConversation"
     WHERE "type" = 'private' AND "participant1Id" = $1 AND "participant2Id" = $2`,
    [p1, p2]
  );
  return row?.id ?? null;
}

async function privateTitle(access: ChatAccess, userId: string): Promise<string> {
  const otherId = otherParticipantId(access, userId);
  if (!otherId) return 'Utilizador';
  const row = await queryOne<{ name: string | null }>('SELECT name FROM "User" WHERE id = $1', [otherId]);
  return row?.name?.trim() || 'Utilizador';
}

async function privateParticipants(access: ChatAccess): Promise<ChatParticipantDto[]> {
  const ids = [access.participant1Id, access.participant2Id].filter((id): id is string => !!id);
  if (ids.length === 0) return [];
  const rows = await query<{ id: string; name: string | null; photoUrl: string | null }>(
    `SELECT id, name, "photoUrl" FROM "User" WHERE id = ANY($1::text[]) ORDER BY name ASC`,
    [ids]
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name ?? '',
    photoUrl: row.photoUrl,
    role: null,
  }));
}

async function groupParticipants(chatId: string): Promise<ChatParticipantDto[]> {
  const rows = await query<{ id: string; name: string | null; photoUrl: string | null; role: string }>(
    `SELECT u.id, u.name, u."photoUrl", m.role
     FROM "ChatMember" m
     JOIN "User" u ON u.id = m."userId"
     WHERE m."chatId" = $1 AND m."leftAt" IS NULL
     ORDER BY CASE m.role
       WHEN 'leader' THEN 0
       WHEN 'support' THEN 1
       WHEN 'sweep' THEN 2
       ELSE 3
     END, u.name ASC`,
    [chatId]
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name ?? '',
    photoUrl: row.photoUrl,
    role: isMemberRole(row.role) ? row.role : 'member',
  }));
}
