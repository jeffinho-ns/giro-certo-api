-- Stories para rede social (histórias de 24h)
CREATE TABLE IF NOT EXISTS "Story" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "mediaUrl" TEXT NOT NULL,
  "likeCount" INTEGER DEFAULT 0,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "Story_userId_idx" ON "Story"("userId");
CREATE INDEX IF NOT EXISTS "Story_createdAt_idx" ON "Story"("createdAt");
