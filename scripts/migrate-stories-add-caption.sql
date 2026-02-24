-- Adiciona coluna opcional caption às stories (legenda/texto)
ALTER TABLE "Story" ADD COLUMN IF NOT EXISTS "caption" TEXT;
