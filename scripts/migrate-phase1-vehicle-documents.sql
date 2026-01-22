-- ============================================
-- MIGRATION FASE 1: Tipos de Veículo e Documentos
-- Data: 2024
-- Descrição: Adiciona suporte a bicicletas, documentos de entregadores e sistema de verificação
-- ============================================

-- 1. Criar novos Enums
CREATE TYPE "VehicleType" AS ENUM ('MOTORCYCLE', 'BICYCLE');
CREATE TYPE "DocumentType" AS ENUM ('RG', 'CNH', 'PASSPORT');
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'UPLOADED', 'APPROVED', 'REJECTED', 'EXPIRED');

-- 2. Adicionar novos campos na tabela User
ALTER TABLE "User" 
  ADD COLUMN IF NOT EXISTS "hasVerifiedDocuments" BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS "verificationBadge" BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS "maintenanceBlockOverride" BOOLEAN DEFAULT false;

-- 3. Atualizar tabela Bike para suportar bicicletas
-- Primeiro, tornar plate nullable
ALTER TABLE "Bike" 
  ALTER COLUMN plate DROP NOT NULL;

-- Adicionar novos campos
ALTER TABLE "Bike"
  ADD COLUMN IF NOT EXISTS "vehicleType" "VehicleType" DEFAULT 'MOTORCYCLE',
  ADD COLUMN IF NOT EXISTS "oilType" TEXT, -- Tornar nullable (bicicletas não precisam)
  ADD COLUMN IF NOT EXISTS "frontTirePressure" DOUBLE PRECISION, -- Tornar nullable
  ADD COLUMN IF NOT EXISTS "rearTirePressure" DOUBLE PRECISION, -- Tornar nullable
  ADD COLUMN IF NOT EXISTS "vehiclePhotoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "platePhotoUrl" TEXT;

-- Atualizar dados existentes: garantir que motos existentes tenham valores padrão
UPDATE "Bike" 
SET 
  "vehicleType" = 'MOTORCYCLE',
  "oilType" = COALESCE("oilType", 'Não especificado'),
  "frontTirePressure" = COALESCE("frontTirePressure", 0.0),
  "rearTirePressure" = COALESCE("rearTirePressure", 0.0)
WHERE "vehicleType" IS NULL;

-- Criar índice para vehicleType
CREATE INDEX IF NOT EXISTS "Bike_vehicleType_idx" ON "Bike"("vehicleType");

-- 4. Criar tabela CourierDocument
CREATE TABLE IF NOT EXISTS "CourierDocument" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "documentType" "DocumentType" NOT NULL,
  status "DocumentStatus" DEFAULT 'PENDING',
  "fileUrl" TEXT,
  "expirationDate" TIMESTAMP,
  "verifiedAt" TIMESTAMP,
  "verifiedBy" TEXT, -- ID do admin que aprovou
  "rejectionReason" TEXT,
  notes TEXT,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "CourierDocument_userId_idx" ON "CourierDocument"("userId");
CREATE INDEX IF NOT EXISTS "CourierDocument_status_idx" ON "CourierDocument"(status);
CREATE INDEX IF NOT EXISTS "CourierDocument_documentType_idx" ON "CourierDocument"("documentType");

-- 5. Criar tabela VerificationSelfie
CREATE TABLE IF NOT EXISTS "VerificationSelfie" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "fileUrl" TEXT NOT NULL,
  status "DocumentStatus" DEFAULT 'UPLOADED',
  "verifiedAt" TIMESTAMP,
  "verifiedBy" TEXT, -- ID do admin
  notes TEXT,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "VerificationSelfie_userId_idx" ON "VerificationSelfie"("userId");
CREATE INDEX IF NOT EXISTS "VerificationSelfie_status_idx" ON "VerificationSelfie"(status);
CREATE INDEX IF NOT EXISTS "VerificationSelfie_createdAt_idx" ON "VerificationSelfie"("createdAt");

-- 6. Comentários para documentação
COMMENT ON TYPE "VehicleType" IS 'Tipo de veículo: MOTORCYCLE ou BICYCLE';
COMMENT ON TYPE "DocumentType" IS 'Tipo de documento: RG, CNH ou PASSPORT';
COMMENT ON TYPE "DocumentStatus" IS 'Status do documento: PENDING, UPLOADED, APPROVED, REJECTED, EXPIRED';

COMMENT ON COLUMN "User"."hasVerifiedDocuments" IS 'Indica se o entregador tem todos os documentos verificados';
COMMENT ON COLUMN "User"."verificationBadge" IS 'Selo de confiança concedido pelo admin';
COMMENT ON COLUMN "User"."maintenanceBlockOverride" IS 'Override manual para permitir entregador com manutenção crítica';

COMMENT ON COLUMN "Bike"."vehicleType" IS 'Tipo de veículo: MOTORCYCLE (padrão) ou BICYCLE';
COMMENT ON COLUMN "Bike"."plate" IS 'Placa do veículo (nullable para bicicletas)';
COMMENT ON COLUMN "Bike"."vehiclePhotoUrl" IS 'URL da foto do veículo';
COMMENT ON COLUMN "Bike"."platePhotoUrl" IS 'URL da foto da placa (apenas para motos)';

-- ============================================
-- FIM DA MIGRATION FASE 1
-- ============================================
