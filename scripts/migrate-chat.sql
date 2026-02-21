-- Chat: conversas privadas (1:1) e mensagens
CREATE TABLE IF NOT EXISTS "ChatConversation" (
  id TEXT PRIMARY KEY,
  "participant1Id" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "participant2Id" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "lastMessageAt" TIMESTAMP,
  "lastMessagePreview" TEXT,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW(),
  UNIQUE("participant1Id", "participant2Id"),
  CHECK ("participant1Id" < "participant2Id")
);

CREATE INDEX IF NOT EXISTS "ChatConversation_participant1_idx" ON "ChatConversation"("participant1Id");
CREATE INDEX IF NOT EXISTS "ChatConversation_participant2_idx" ON "ChatConversation"("participant2Id");

CREATE TABLE IF NOT EXISTS "ChatMessage" (
  id TEXT PRIMARY KEY,
  "chatId" TEXT NOT NULL REFERENCES "ChatConversation"(id) ON DELETE CASCADE,
  "senderId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "ChatMessage_chatId_idx" ON "ChatMessage"("chatId");
CREATE INDEX IF NOT EXISTS "ChatMessage_createdAt_idx" ON "ChatMessage"("createdAt");
