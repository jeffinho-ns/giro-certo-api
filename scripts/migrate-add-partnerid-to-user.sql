-- ============================================
-- MIGRATION: Adicionar partnerId à tabela User
-- Data: 2024
-- Descrição: Permite vincular usuários a parceiros (lojistas)
-- ============================================

-- Adicionar coluna partnerId na tabela User
ALTER TABLE "User" 
  ADD COLUMN IF NOT EXISTS "partnerId" TEXT REFERENCES "Partner"(id) ON DELETE SET NULL;

-- Criar índice para busca rápida
CREATE INDEX IF NOT EXISTS "User_partnerId_idx" ON "User"("partnerId") WHERE "partnerId" IS NOT NULL;

-- Comentário
COMMENT ON COLUMN "User"."partnerId" IS 'ID do parceiro vinculado (para lojistas)';
