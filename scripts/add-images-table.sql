-- Tabela para armazenar imagens no banco de dados
CREATE TABLE IF NOT EXISTS "Image" (
  id TEXT PRIMARY KEY,
  "entityType" TEXT NOT NULL, -- 'user', 'bike', 'partner', 'post', 'promotion', etc
  "entityId" TEXT NOT NULL, -- ID da entidade relacionada
  filename TEXT NOT NULL,
  mimetype TEXT NOT NULL, -- 'image/jpeg', 'image/png', etc
  size INTEGER NOT NULL, -- tamanho em bytes
  data BYTEA NOT NULL, -- dados binários da imagem
  "isPrimary" BOOLEAN DEFAULT false, -- se é a imagem principal da entidade
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX "Image_entity_idx" ON "Image"("entityType", "entityId");
CREATE INDEX "Image_entityId_idx" ON "Image"("entityId");

-- Comentários
COMMENT ON TABLE "Image" IS 'Armazena todas as imagens do sistema (perfis, motos, lojistas, posts, etc)';
COMMENT ON COLUMN "Image"."entityType" IS 'Tipo da entidade: user, bike, partner, post, promotion';
COMMENT ON COLUMN "Image"."entityId" IS 'ID da entidade relacionada';
COMMENT ON COLUMN "Image".data IS 'Dados binários da imagem em formato BYTEA';
