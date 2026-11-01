import { randomBytes } from 'crypto';
import { query, queryOne } from '../lib/db';
import { generateId } from '../utils/id';
import { ensureChatSchema, withDbTransaction } from './chat-schema';
import {
  assertChatAccess,
  loadConversationDto,
  publishSystemMessage,
  unhideForUser,
} from './chat.service';
import {
  asRecord,
  ChatAccess,
  ChatHttpError,
  ChatIo,
  isUniqueViolation,
  parseGroupPatch,
  parseMeetupPatch,
  parseMemberIds,
  parseOptionalImage,
  parseRole,
  parseTitle,
  parseUserId,
  toCount,
  toIso,
  toNumber,
} from './chat.types';
import { ChatMemberRole, ConversationDto, MessageDto } from '../types';
import { listGoingUserIds } from './event-rsvp.service';

const MAX_MEMBERS = 100;
const ROLE_LABEL: Record<ChatMemberRole, string> = {
  leader: 'líder',
  support: 'suporte',
  sweep: 'batedor',
  member: 'membro',
};

export async function createGroup(userId: string, body: unknown): Promise<ConversationDto> {
  await ensureChatSchema();
  const record = asRecord(body);
  const title = parseTitle(record.title);
  const imageUrl = Object.prototype.hasOwnProperty.call(record, 'imageUrl')
    ? parseOptionalImage(record.imageUrl)
    : null;
  const requested = [...new Set(parseMemberIds(record.memberIds))].filter((id) => id !== userId);
  if (requested.length > 500) throw new ChatHttpError(400, 'Demasiados membros.');

  const found = requested.length
    ? await query<{ id: string }>(`SELECT id FROM "User" WHERE id = ANY($1::text[])`, [requested])
    : [];
  const memberIds = found.map((row) => row.id);
  if (memberIds.length + 1 > MAX_MEMBERS) {
    throw new ChatHttpError(400, 'O grupo pode ter no máximo 100 membros.');
  }

  const chatId = generateId();
  await withDbTransaction(async (client) => {
    await client.query(
      `INSERT INTO "ChatConversation" (
         id, "participant1Id", "participant2Id", "type", title, "imageUrl", "createdById",
         "createdAt", "updatedAt"
       ) VALUES ($1, NULL, NULL, 'group', $2, $3, $4, NOW(), NOW())`,
      [chatId, title, imageUrl, userId]
    );
    await client.query(
      `INSERT INTO "ChatMember" (id, "chatId", "userId", role, "joinedAt")
       VALUES ($1, $2, $3, 'leader', NOW())`,
      [generateId(), chatId, userId]
    );
    for (const memberId of memberIds) {
      await client.query(
        `INSERT INTO "ChatMember" (id, "chatId", "userId", role, "joinedAt")
         VALUES ($1, $2, $3, 'member', NOW())`,
        [generateId(), chatId, memberId]
      );
    }
  });
  return loadConversationDto(userId, chatId);
}

export async function openEventGroup(
  userId: string,
  body: unknown
): Promise<{ conversation: ConversationDto; created: boolean }> {
  await ensureChatSchema();
  const eventId = parseUserId(asRecord(body).eventId, 'eventId');
  const event = await loadEvent(eventId);
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM "ChatConversation" WHERE "type" = 'group' AND "eventId" = $1`,
    [eventId]
  );
  if (existing) {
    await ensureActiveMember(existing.id, userId, 'member');
    await unhideForUser(existing.id, userId);
    return { conversation: await loadConversationDto(userId, existing.id), created: false };
  }

  const chatId = generateId();
  const goingIds = await listGoingUserIds(eventId);
  const memberMap = new Map<string, ChatMemberRole>();
  memberMap.set(event.createdByUserId, 'leader');
  for (const goingId of goingIds) {
    if (!memberMap.has(goingId)) memberMap.set(goingId, 'member');
  }
  if (!memberMap.has(userId)) {
    memberMap.set(userId, userId === event.createdByUserId ? 'leader' : 'member');
  }
  const members = [...memberMap.entries()].map(([id, role]) => ({ id, role }));

  try {
    await withDbTransaction(async (client) => {
      await client.query(
        `INSERT INTO "ChatConversation" (
           id, "participant1Id", "participant2Id", "type", title, "createdById",
           "eventId", "meetupLabel", "meetupLat", "meetupLng", "meetupAt",
           "createdAt", "updatedAt"
         ) VALUES (
           $1, NULL, NULL, 'group', $2, $3,
           $4, $5, $6, $7, $8,
           NOW(), NOW()
         )`,
        [
          chatId,
          event.title.slice(0, 80),
          userId,
          eventId,
          event.meetupLabel,
          event.lat,
          event.lng,
          event.dateTime,
        ]
      );
      for (const member of members) {
        await client.query(
          `INSERT INTO "ChatMember" (id, "chatId", "userId", role, "joinedAt")
           VALUES ($1, $2, $3, $4, NOW())`,
          [generateId(), chatId, member.id, member.role]
        );
      }
    });
    await unhideForUser(chatId, userId);
    return { conversation: await loadConversationDto(userId, chatId), created: true };
  } catch (error: unknown) {
    if (!isUniqueViolation(error)) throw error;
    const again = await queryOne<{ id: string }>(
      `SELECT id FROM "ChatConversation" WHERE "type" = 'group' AND "eventId" = $1`,
      [eventId]
    );
    if (!again) throw error;
    await ensureActiveMember(again.id, userId, 'member');
    await unhideForUser(again.id, userId);
    return { conversation: await loadConversationDto(userId, again.id), created: false };
  }
}

export async function joinByCode(userId: string, body: unknown): Promise<ConversationDto> {
  await ensureChatSchema();
  const code = parseUserId(asRecord(body).code, 'code').replace(/\s+/g, '');
  const invite = await queryOne<{ chatId: string }>(
    `SELECT "chatId" FROM "ChatInvite" WHERE code = $1 AND "expiresAt" > NOW()`,
    [code]
  );
  if (!invite) throw new ChatHttpError(404, 'Convite inválido ou expirado.');
  const chat = await queryOne<{ type: string }>(
    `SELECT "type" FROM "ChatConversation" WHERE id = $1`,
    [invite.chatId]
  );
  if (!chat || chat.type !== 'group') {
    throw new ChatHttpError(404, 'Convite inválido ou expirado.');
  }
  await ensureActiveMember(invite.chatId, userId, 'member');
  await unhideForUser(invite.chatId, userId);
  return loadConversationDto(userId, invite.chatId);
}

export async function updateGroup(userId: string, chatId: string, body: unknown): Promise<ConversationDto> {
  const access = await assertChatAccess(userId, chatId);
  requireLeader(access);
  const patch = parseGroupPatch(body);
  const sets: string[] = [];
  const params: Array<string | null> = [];
  if (patch.title !== undefined) {
    params.push(patch.title);
    sets.push(`title = $${params.length}`);
  }
  if (patch.imageUrl !== undefined) {
    params.push(patch.imageUrl);
    sets.push(`"imageUrl" = $${params.length}`);
  }
  params.push(chatId);
  await query(
    `UPDATE "ChatConversation" SET ${sets.join(', ')}, "updatedAt" = NOW() WHERE id = $${params.length}`,
    params
  );
  return loadConversationDto(userId, chatId);
}

export async function updateMeetup(
  userId: string,
  chatId: string,
  body: unknown,
  io: ChatIo | null
): Promise<{
  meetupLabel: string | null;
  meetupLat: number | null;
  meetupLng: number | null;
  meetupAt: string | null;
  message: MessageDto;
}> {
  const access = await assertChatAccess(userId, chatId);
  requireLeader(access);
  const patch = parseMeetupPatch(body);
  const sets: string[] = [];
  const params: Array<string | number | Date | null> = [];
  if (patch.label !== undefined) {
    params.push(patch.label);
    sets.push(`"meetupLabel" = $${params.length}`);
  }
  if (patch.lat !== undefined) {
    params.push(patch.lat);
    sets.push(`"meetupLat" = $${params.length}`);
    params.push(patch.lng ?? null);
    sets.push(`"meetupLng" = $${params.length}`);
  }
  if (patch.at !== undefined) {
    params.push(patch.at);
    sets.push(`"meetupAt" = $${params.length}`);
  }
  if (sets.length === 0) {
    throw new ChatHttpError(400, 'Nada para atualizar no ponto de encontro.');
  }
  params.push(chatId);
  await query(
    `UPDATE "ChatConversation" SET ${sets.join(', ')}, "updatedAt" = NOW() WHERE id = $${params.length}`,
    params
  );
  const message = await publishSystemMessage(io, chatId, userId, 'Ponto de encontro atualizado.');
  const row = await queryOne<{
    meetupLabel: string | null;
    meetupLat: number | null;
    meetupLng: number | null;
    meetupAt: Date | null;
  }>(
    `SELECT "meetupLabel", "meetupLat", "meetupLng", "meetupAt" FROM "ChatConversation" WHERE id = $1`,
    [chatId]
  );
  if (row?.meetupAt && new Date(row.meetupAt).getTime() <= Date.now()) {
    const already = await queryOne<{ id: string }>(
      `SELECT id FROM "ChatMessage"
       WHERE "chatId" = $1 AND "type" = 'system' AND text = $2
       LIMIT 1`,
      [chatId, 'Rolê encerrado.']
    );
    if (!already) {
      await publishSystemMessage(io, chatId, userId, 'Rolê encerrado.');
    }
  }
  return {
    meetupLabel: row?.meetupLabel ?? null,
    meetupLat: toNumber(row?.meetupLat),
    meetupLng: toNumber(row?.meetupLng),
    meetupAt: toIso(row?.meetupAt),
    message,
  };
}

export async function updateMemberRole(
  userId: string,
  chatId: string,
  targetUserId: string,
  body: unknown,
  io: ChatIo | null
): Promise<{ role: ChatMemberRole; message: MessageDto | null }> {
  const access = await assertChatAccess(userId, chatId);
  requireLeader(access);
  const role = parseRole(asRecord(body).role);
  const member = await queryOne<{ role: string; leftAt: Date | null; name: string | null }>(
    `SELECT m.role, m."leftAt", u.name
     FROM "ChatMember" m
     JOIN "User" u ON u.id = m."userId"
     WHERE m."chatId" = $1 AND m."userId" = $2`,
    [chatId, targetUserId]
  );
  if (!member || member.leftAt) throw new ChatHttpError(404, 'Membro não encontrado');
  if (member.role === role) return { role, message: null };
  if (role !== 'leader') {
    const others = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n
       FROM "ChatMember"
       WHERE "chatId" = $1 AND role = 'leader' AND "leftAt" IS NULL AND "userId" <> $2`,
      [chatId, targetUserId]
    );
    if (toCount(others?.n) < 1) {
      throw new ChatHttpError(400, 'O grupo precisa de pelo menos um líder.');
    }
  }
  await query(
    `UPDATE "ChatMember" SET role = $3 WHERE "chatId" = $1 AND "userId" = $2 AND "leftAt" IS NULL`,
    [chatId, targetUserId, role]
  );
  const message = await publishSystemMessage(
    io,
    chatId,
    userId,
    `${member.name?.trim() || 'Um membro'} agora é ${ROLE_LABEL[role]}.`
  );
  return { role, message };
}

export async function createInvite(
  userId: string,
  chatId: string
): Promise<{ code: string; expiresAt: string }> {
  const access = await assertChatAccess(userId, chatId);
  if (access.type !== 'group') {
    throw new ChatHttpError(400, 'Convites só estão disponíveis em grupos.');
  }
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newInviteCode();
    try {
      await query(
        `INSERT INTO "ChatInvite" (id, "chatId", code, "createdById", "expiresAt", "createdAt")
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [generateId(), chatId, code, userId, expires]
      );
      return { code, expiresAt: expires.toISOString() };
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new ChatHttpError(500, 'Não foi possível criar o convite.');
}

function requireLeader(access: ChatAccess): void {
  if (access.type !== 'group') throw new ChatHttpError(400, 'Disponível apenas em grupos.');
  if (access.myRole !== 'leader') throw new ChatHttpError(403, 'Apenas o líder pode fazer isto.');
}

async function ensureActiveMember(chatId: string, userId: string, role: ChatMemberRole): Promise<void> {
  await withDbTransaction(async (client) => {
    await client.query(`SELECT id FROM "ChatConversation" WHERE id = $1 FOR UPDATE`, [chatId]);
    const existing = await client.query<{ leftAt: Date | null }>(
      `SELECT "leftAt" FROM "ChatMember" WHERE "chatId" = $1 AND "userId" = $2`,
      [chatId, userId]
    );
    if (existing.rows[0] && existing.rows[0].leftAt == null) return;
    const count = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "ChatMember" WHERE "chatId" = $1 AND "leftAt" IS NULL`,
      [chatId]
    );
    if (toCount(count.rows[0]?.n) >= MAX_MEMBERS) {
      throw new ChatHttpError(400, 'O grupo pode ter no máximo 100 membros.');
    }
    await client.query(
      `INSERT INTO "ChatMember" (id, "chatId", "userId", role, "joinedAt")
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT ("chatId", "userId") DO UPDATE
       SET "leftAt" = NULL,
           role = CASE
             WHEN "ChatMember"."leftAt" IS NULL THEN "ChatMember".role
             ELSE EXCLUDED.role
           END`,
      [generateId(), chatId, userId, role]
    );
  });
}

async function loadEvent(eventId: string): Promise<{
  title: string;
  dateTime: Date;
  lat: number | null;
  lng: number | null;
  meetupLabel: string;
  createdByUserId: string;
}> {
  const hasTable = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables WHERE table_name = 'SocialEvent'
     ) AS exists`
  );
  if (!hasTable?.exists) throw new ChatHttpError(404, 'Evento não encontrado');
  const event = await queryOne<{
    title: string | null;
    dateTime: Date;
    lat: number | null;
    lng: number | null;
    address: string | null;
    createdByUserId: string;
  }>(
    `SELECT title, "dateTime", lat, lng, address, "createdByUserId"
     FROM "SocialEvent" WHERE id = $1`,
    [eventId]
  );
  if (!event) throw new ChatHttpError(404, 'Evento não encontrado');
  const title = event.title?.trim() ?? '';
  if (!title) throw new ChatHttpError(400, 'Evento sem título.');
  return {
    title,
    dateTime: event.dateTime,
    lat: event.lat,
    lng: event.lng,
    meetupLabel: event.address?.trim() || title,
    createdByUserId: event.createdByUserId,
  };
}

function newInviteCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bytes = randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i += 1) code += alphabet[bytes[i] % alphabet.length];
  return code;
}
