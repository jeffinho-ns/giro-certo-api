import fs from 'fs';
import path from 'path';
import { query, queryOne, transaction } from '../lib/db';
import { generateId } from '../utils/id';

export type EventRsvpStatus = 'going' | 'maybe' | 'declined';

export class EventRsvpHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'EventRsvpHttpError';
  }
}

let schemaReady = false;
let schemaPending: Promise<void> | null = null;

function migrationSqlPath(): string {
  const candidates = [
    path.resolve(__dirname, '../../scripts/migrate-event-rsvp.sql'),
    path.resolve(process.cwd(), 'scripts/migrate-event-rsvp.sql'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Migração EventRsvp não encontrada.');
}

export function ensureEventRsvpSchema(): Promise<void> {
  if (schemaReady) return Promise.resolve();
  if (!schemaPending) {
    schemaPending = transaction(async (client) => {
      const sql = fs.readFileSync(migrationSqlPath(), 'utf8');
      await client.query(sql);
    })
      .then(() => {
        schemaReady = true;
      })
      .catch((error: unknown) => {
        schemaPending = null;
        throw error;
      });
  }
  return schemaPending;
}

function parseStatus(value: unknown): EventRsvpStatus {
  if (value === 'going' || value === 'maybe' || value === 'declined') return value;
  throw new EventRsvpHttpError(400, 'status inválido');
}

async function assertEventExists(eventId: string): Promise<void> {
  const hasTable = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables WHERE table_name = 'SocialEvent'
     ) AS exists`
  );
  if (!hasTable?.exists) {
    throw new EventRsvpHttpError(404, 'Evento não encontrado');
  }
  const event = await queryOne<{ id: string }>(
    `SELECT id FROM "SocialEvent" WHERE id = $1`,
    [eventId]
  );
  if (!event) throw new EventRsvpHttpError(404, 'Evento não encontrado');
}

/** Se o grupo do evento já existir, adiciona o utilizador como membro. */
async function joinExistingEventGroup(
  eventId: string,
  userId: string
): Promise<string | null> {
  const hasChat = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables WHERE table_name = 'ChatConversation'
     ) AS exists`
  );
  if (!hasChat?.exists) return null;

  const group = await queryOne<{ id: string }>(
    `SELECT id FROM "ChatConversation" WHERE "type" = 'group' AND "eventId" = $1`,
    [eventId]
  );
  if (!group) return null;

  const existing = await queryOne<{ leftAt: Date | null }>(
    `SELECT "leftAt" FROM "ChatMember" WHERE "chatId" = $1 AND "userId" = $2`,
    [group.id, userId]
  );
  if (!existing) {
    await query(
      `INSERT INTO "ChatMember" (id, "chatId", "userId", role, "joinedAt")
       VALUES ($1, $2, $3, 'member', NOW())
       ON CONFLICT ("chatId", "userId")
       DO UPDATE SET "leftAt" = NULL,
                     role = CASE
                       WHEN "ChatMember"."leftAt" IS NULL THEN "ChatMember".role
                       ELSE EXCLUDED.role
                     END`,
      [generateId(), group.id, userId]
    );
  } else if (existing.leftAt) {
    await query(
      `UPDATE "ChatMember"
       SET "leftAt" = NULL, "joinedAt" = NOW()
       WHERE "chatId" = $1 AND "userId" = $2`,
      [group.id, userId]
    );
  }

  await query(
    `DELETE FROM "ChatConversationHidden" WHERE "chatId" = $1 AND "userId" = $2`,
    [group.id, userId]
  );
  return group.id;
}

export async function getEventRsvp(
  userId: string,
  eventId: string
): Promise<{
  myStatus: EventRsvpStatus | null;
  counts: { going: number; maybe: number; declined: number };
}> {
  await ensureEventRsvpSchema();
  await assertEventExists(eventId);

  const mine = await queryOne<{ status: string }>(
    `SELECT status FROM "EventRsvp" WHERE "eventId" = $1 AND "userId" = $2`,
    [eventId, userId]
  );
  const rows = await query<{ status: string; n: number }>(
    `SELECT status, COUNT(*)::int AS n
     FROM "EventRsvp"
     WHERE "eventId" = $1
     GROUP BY status`,
    [eventId]
  );
  const counts = { going: 0, maybe: 0, declined: 0 };
  for (const row of rows) {
    if (row.status === 'going') counts.going = row.n;
    else if (row.status === 'maybe') counts.maybe = row.n;
    else if (row.status === 'declined') counts.declined = row.n;
  }
  const myStatus =
    mine?.status === 'going' || mine?.status === 'maybe' || mine?.status === 'declined'
      ? mine.status
      : null;
  return { myStatus, counts };
}

export async function setEventRsvp(
  userId: string,
  eventId: string,
  body: unknown
): Promise<{
  myStatus: EventRsvpStatus;
  counts: { going: number; maybe: number; declined: number };
  conversationId: string | null;
}> {
  await ensureEventRsvpSchema();
  await assertEventExists(eventId);
  const record =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const status = parseStatus(record.status);

  await query(
    `INSERT INTO "EventRsvp" (id, "eventId", "userId", status, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT ("eventId", "userId")
     DO UPDATE SET status = EXCLUDED.status, "updatedAt" = NOW()`,
    [generateId(), eventId, userId, status]
  );

  let conversationId: string | null = null;
  if (status === 'going') {
    conversationId = await joinExistingEventGroup(eventId, userId);
  }

  const snapshot = await getEventRsvp(userId, eventId);
  return {
    myStatus: status,
    counts: snapshot.counts,
    conversationId,
  };
}

export async function listGoingUserIds(eventId: string): Promise<string[]> {
  await ensureEventRsvpSchema();
  const hasTable = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables WHERE table_name = 'EventRsvp'
     ) AS exists`
  );
  if (!hasTable?.exists) return [];
  const rows = await query<{ userId: string }>(
    `SELECT "userId" FROM "EventRsvp" WHERE "eventId" = $1 AND status = 'going'`,
    [eventId]
  );
  return rows.map((row) => row.userId);
}
