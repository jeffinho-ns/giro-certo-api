-- Migração: rede social mais rica (postType, hashtags, reações, eventos, conquistas, POI, mapa, story template)
-- Execute após migrate.sql e demais migrações existentes.

-- 1) Post: tipo e hashtags
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "postType" TEXT DEFAULT 'NORMAL';
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "hashtags" TEXT[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS "Post_postType_idx" ON "Post"("postType");
CREATE INDEX IF NOT EXISTS "Post_hashtags_idx" ON "Post" USING GIN("hashtags");

-- 2) Reações além de like (BOA_ROTA, BOA_DICA). LIKE continua em PostLike.
CREATE TABLE IF NOT EXISTS "PostReaction" (
  id TEXT PRIMARY KEY,
  "postId" TEXT NOT NULL REFERENCES "Post"(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "reactionType" TEXT NOT NULL CHECK ("reactionType" IN ('LIKE', 'BOA_ROTA', 'BOA_DICA')),
  "createdAt" TIMESTAMP DEFAULT NOW(),
  UNIQUE("postId", "userId")
);
CREATE INDEX IF NOT EXISTS "PostReaction_postId_idx" ON "PostReaction"("postId");
CREATE INDEX IF NOT EXISTS "PostReaction_userId_idx" ON "PostReaction"("userId");

-- 3) Eventos da rede social (para mapa e lista)
CREATE TABLE IF NOT EXISTS "SocialEvent" (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  "dateTime" TIMESTAMP NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  address TEXT,
  "communityId" TEXT,
  "createdByUserId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "SocialEvent_createdByUserId_idx" ON "SocialEvent"("createdByUserId");
CREATE INDEX IF NOT EXISTS "SocialEvent_dateTime_idx" ON "SocialEvent"("dateTime");
CREATE INDEX IF NOT EXISTS "SocialEvent_communityId_idx" ON "SocialEvent"("communityId");

-- 4) Conquistas (definições) e desbloqueios por utilizador
CREATE TABLE IF NOT EXISTS "Achievement" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  "iconName" TEXT,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "UserAchievement" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "achievementId" TEXT NOT NULL REFERENCES "Achievement"(id) ON DELETE CASCADE,
  "unlockedAt" TIMESTAMP DEFAULT NOW(),
  UNIQUE("userId", "achievementId")
);
CREATE INDEX IF NOT EXISTS "UserAchievement_userId_idx" ON "UserAchievement"("userId");

-- Inserir conquistas padrão (se não existirem)
INSERT INTO "Achievement" (id, name, description, "iconName") VALUES
  ('ach_first_post', 'Primeira publicação', 'Publicaste o teu primeiro post', 'file-text'),
  ('ach_100_km', '100 km', 'Completaste 100 km registados', 'map-pin'),
  ('ach_delivery_10', '10 entregas', 'Completaste 10 entregas', 'package'),
  ('ach_social_10', '10 seguidores', 'Alcançaste 10 seguidores', 'users'),
  ('ach_tip', 'Boa dica', 'A tua dica de manutenção recebeu 5+ "Boa dica"', 'wrench')
ON CONFLICT (id) DO NOTHING;

-- 5) Pontos de interesse partilhados (mecânico, posto, paragem)
CREATE TABLE IF NOT EXISTS "PointOfInterest" (
  id TEXT PRIMARY KEY,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'other',
  "postId" TEXT REFERENCES "Post"(id) ON DELETE SET NULL,
  "userId" TEXT REFERENCES "User"(id) ON DELETE SET NULL,
  "userName" TEXT,
  "createdAt" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "PointOfInterest_lat_lng_idx" ON "PointOfInterest"(lat, lng);
CREATE INDEX IF NOT EXISTS "PointOfInterest_type_idx" ON "PointOfInterest"(type);

-- 6) User: visibilidade no mapa (pilotos perto de mim / entregadores ativos)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "showOnMap" BOOLEAN DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "showAsDelivery" BOOLEAN DEFAULT false;

-- 7) Story: template (NORMAL, EM_ENTREGA, ROTA_DO_DIA)
ALTER TABLE "Story" ADD COLUMN IF NOT EXISTS "template" TEXT DEFAULT 'NORMAL';
ALTER TABLE "Story" ADD COLUMN IF NOT EXISTS "caption" TEXT;

-- 8) Community (se a app usar): tipo e zona
CREATE TABLE IF NOT EXISTS "Community" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  "imageUrl" TEXT,
  "createdByUserId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  type TEXT DEFAULT 'GERAL',
  zone TEXT,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "Community_type_idx" ON "Community"(type);
