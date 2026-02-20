-- Adiciona coluna coverUrl à tabela User (imagem de capa do perfil)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "coverUrl" TEXT;
COMMENT ON COLUMN "User"."coverUrl" IS 'URL da imagem de capa do perfil (rede social)';
