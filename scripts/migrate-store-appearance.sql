-- Loja Virtual — Fase 2: personalização da loja (capa + cor de destaque).
-- Idempotente.

ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "storeCoverUrl" TEXT;
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "storeThemeColor" TEXT;
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "storeDescription" TEXT;
