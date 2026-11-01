-- Chat rico: grupos, mídia, preferências, bloqueio, denúncia e convites.
-- Idempotente. Não remove a primary key de ChatConversation.
-- O par 1:1 deixa de ser UNIQUE/CHECK global e passa a índice único parcial (type = private).

CREATE TABLE IF NOT EXISTS "ChatConversation" (
  id TEXT PRIMARY KEY,
  "participant1Id" TEXT REFERENCES "User"(id) ON DELETE CASCADE,
  "participant2Id" TEXT REFERENCES "User"(id) ON DELETE CASCADE,
  "type" TEXT NOT NULL DEFAULT 'private',
  title TEXT,
  "imageUrl" TEXT,
  "createdById" TEXT REFERENCES "User"(id) ON DELETE SET NULL,
  "eventId" TEXT,
  "pinnedMessageId" TEXT,
  "meetupLabel" TEXT,
  "meetupLat" DOUBLE PRECISION,
  "meetupLng" DOUBLE PRECISION,
  "meetupAt" TIMESTAMP,
  "lastMessageAt" TIMESTAMP,
  "lastMessagePreview" TEXT,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "ChatConversation_participant1_idx" ON "ChatConversation"("participant1Id");
CREATE INDEX IF NOT EXISTS "ChatConversation_participant2_idx" ON "ChatConversation"("participant2Id");

CREATE TABLE IF NOT EXISTS "ChatMessage" (
  id TEXT PRIMARY KEY,
  "chatId" TEXT NOT NULL REFERENCES "ChatConversation"(id) ON DELETE CASCADE,
  "senderId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'text',
  "mediaUrl" TEXT,
  "mediaDurationMs" INTEGER,
  "replyToId" TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  "locationLabel" TEXT,
  "deletedAt" TIMESTAMP,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "ChatMessage_chatId_idx" ON "ChatMessage"("chatId");
CREATE INDEX IF NOT EXISTS "ChatMessage_createdAt_idx" ON "ChatMessage"("createdAt");
CREATE INDEX IF NOT EXISTS "ChatMessage_chatId_createdAt_idx" ON "ChatMessage"("chatId", "createdAt");

ALTER TABLE "ChatConversation" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'private';
ALTER TABLE "ChatConversation" ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE "ChatConversation" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
ALTER TABLE "ChatConversation" ADD COLUMN IF NOT EXISTS "createdById" TEXT;
ALTER TABLE "ChatConversation" ADD COLUMN IF NOT EXISTS "eventId" TEXT;
ALTER TABLE "ChatConversation" ADD COLUMN IF NOT EXISTS "pinnedMessageId" TEXT;
ALTER TABLE "ChatConversation" ADD COLUMN IF NOT EXISTS "meetupLabel" TEXT;
ALTER TABLE "ChatConversation" ADD COLUMN IF NOT EXISTS "meetupLat" DOUBLE PRECISION;
ALTER TABLE "ChatConversation" ADD COLUMN IF NOT EXISTS "meetupLng" DOUBLE PRECISION;
ALTER TABLE "ChatConversation" ADD COLUMN IF NOT EXISTS "meetupAt" TIMESTAMP;

-- contype c = CHECK, u = UNIQUE. A primary key (contype p) e as FKs (contype f) ficam.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT nsp.nspname AS schema_name, con.conname AS constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'ChatConversation'
      AND rel.relkind = 'r'
      AND con.contype IN ('c', 'u')
      AND nsp.nspname NOT IN ('pg_catalog', 'information_schema')
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
      r.schema_name,
      'ChatConversation',
      r.constraint_name
    );
  END LOOP;
END $$;

ALTER TABLE "ChatConversation" ALTER COLUMN "participant1Id" DROP NOT NULL;
ALTER TABLE "ChatConversation" ALTER COLUMN "participant2Id" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ChatConversation_private_pair_uidx"
  ON "ChatConversation" ("participant1Id", "participant2Id")
  WHERE "type" = 'private' AND "participant1Id" IS NOT NULL AND "participant2Id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ChatConversation_group_event_uidx"
  ON "ChatConversation" ("eventId")
  WHERE "type" = 'group' AND "eventId" IS NOT NULL;

ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'text';
ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "mediaUrl" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "mediaDurationMs" INTEGER;
ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "replyToId" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "locationLabel" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP;

CREATE TABLE IF NOT EXISTS "ChatMember" (
  id TEXT PRIMARY KEY,
  "chatId" TEXT NOT NULL REFERENCES "ChatConversation"(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('leader', 'support', 'sweep', 'member')),
  "joinedAt" TIMESTAMP DEFAULT NOW(),
  "leftAt" TIMESTAMP,
  UNIQUE ("chatId", "userId")
);

CREATE INDEX IF NOT EXISTS "ChatMember_userId_idx" ON "ChatMember"("userId");
CREATE INDEX IF NOT EXISTS "ChatMember_userId_active_idx" ON "ChatMember"("userId") WHERE "leftAt" IS NULL;

CREATE TABLE IF NOT EXISTS "ChatUserPref" (
  id TEXT PRIMARY KEY,
  "chatId" TEXT NOT NULL REFERENCES "ChatConversation"(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "pinnedAt" TIMESTAMP,
  "archivedAt" TIMESTAMP,
  "lastReadAt" TIMESTAMP,
  UNIQUE ("chatId", "userId")
);

CREATE TABLE IF NOT EXISTS "ChatBlock" (
  id TEXT PRIMARY KEY,
  "blockerId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "blockedId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  UNIQUE ("blockerId", "blockedId"),
  CHECK ("blockerId" <> "blockedId")
);

CREATE INDEX IF NOT EXISTS "ChatBlock_blockedId_idx" ON "ChatBlock"("blockedId");

CREATE TABLE IF NOT EXISTS "ChatReport" (
  id TEXT PRIMARY KEY,
  "reporterId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "targetUserId" TEXT REFERENCES "User"(id) ON DELETE SET NULL,
  "chatId" TEXT REFERENCES "ChatConversation"(id) ON DELETE SET NULL,
  "messageId" TEXT REFERENCES "ChatMessage"(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "ChatInvite" (
  id TEXT PRIMARY KEY,
  "chatId" TEXT NOT NULL REFERENCES "ChatConversation"(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "expiresAt" TIMESTAMP NOT NULL,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "ChatInvite_chatId_idx" ON "ChatInvite"("chatId");

CREATE TABLE IF NOT EXISTS "ChatConversationHidden" (
  id TEXT PRIMARY KEY,
  "chatId" TEXT NOT NULL REFERENCES "ChatConversation"(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "hiddenAt" TIMESTAMP DEFAULT NOW(),
  UNIQUE ("chatId", "userId")
);

CREATE TABLE IF NOT EXISTS "ChatMute" (
  id TEXT PRIMARY KEY,
  "chatId" TEXT NOT NULL REFERENCES "ChatConversation"(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  muted BOOLEAN DEFAULT true,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW(),
  UNIQUE ("chatId", "userId")
);
