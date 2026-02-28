-- Tokens FCM por utilizador (para notificações push quando o telemóvel está bloqueado)
CREATE TABLE IF NOT EXISTS "UserFcmToken" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  UNIQUE("userId", token)
);

CREATE INDEX IF NOT EXISTS "UserFcmToken_userId_idx" ON "UserFcmToken"("userId");
