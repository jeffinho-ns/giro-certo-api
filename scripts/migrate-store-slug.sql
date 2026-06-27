-- ============================================
-- MIGRATION: slug público da loja (Partner.slug)
-- Loja Virtual — Passo 3. Identifica a loja na URL pública (/loja/<slug>).
-- Execute: npm run db:migrate:store-slug  (o runner também faz o backfill)
-- Idempotente.
-- ============================================

ALTER TABLE "Partner"
  ADD COLUMN IF NOT EXISTS slug TEXT;

-- Único quando preenchido (permite NULL temporário antes do backfill).
CREATE UNIQUE INDEX IF NOT EXISTS "Partner_slug_key"
  ON "Partner"(slug) WHERE slug IS NOT NULL;

COMMENT ON COLUMN "Partner".slug IS 'Identificador público da loja na URL (nome em minúsculas separado por hífen).';
