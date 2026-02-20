-- Migração: Pedidos de seguimento (follow request) + notificações
-- 1. Tabela FollowRequest
-- 2. Novo tipo de alerta FOLLOW_REQUEST
-- 3. Coluna metadata na Alert (para followRequestId)

-- Tabela de pedidos de seguimento
CREATE TABLE IF NOT EXISTS "FollowRequest" (
  id TEXT PRIMARY KEY,
  "requesterId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "targetId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "respondedAt" TIMESTAMP,
  UNIQUE("requesterId", "targetId")
);

CREATE INDEX IF NOT EXISTS "FollowRequest_requesterId_idx" ON "FollowRequest"("requesterId");
CREATE INDEX IF NOT EXISTS "FollowRequest_targetId_idx" ON "FollowRequest"("targetId");
CREATE INDEX IF NOT EXISTS "FollowRequest_status_idx" ON "FollowRequest"(status);

-- Adicionar valor FOLLOW_REQUEST ao enum AlertType (PostgreSQL 10+)
DO $$ BEGIN
  ALTER TYPE "AlertType" ADD VALUE 'FOLLOW_REQUEST';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Coluna metadata para dados extras (ex: followRequestId)
ALTER TABLE "Alert" ADD COLUMN IF NOT EXISTS metadata JSONB;

COMMENT ON TABLE "FollowRequest" IS 'Pedidos de seguimento entre utilizadores (rede social)';
COMMENT ON COLUMN "Alert".metadata IS 'Dados extras (ex: followRequestId para tipo FOLLOW_REQUEST)';
