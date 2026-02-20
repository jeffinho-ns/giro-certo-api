-- Migração: Tabela Follow (rede social - seguir utilizadores)
-- Executar no PostgreSQL

CREATE TABLE IF NOT EXISTS "Follow" (
  id TEXT PRIMARY KEY,
  "followerId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "followingId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  UNIQUE("followerId", "followingId"),
  CHECK ("followerId" != "followingId")
);

CREATE INDEX IF NOT EXISTS "Follow_followerId_idx" ON "Follow"("followerId");
CREATE INDEX IF NOT EXISTS "Follow_followingId_idx" ON "Follow"("followingId");

COMMENT ON TABLE "Follow" IS 'Relação de seguir entre utilizadores (rede social)';
