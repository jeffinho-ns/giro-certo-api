-- ============================================
-- MIGRATION FASE 2: Expansão do Modelo Partner
-- Data: 2024
-- Descrição: Adiciona dados empresariais, módulo financeiro e configurações operacionais
-- ============================================

-- 1. Criar novos Enums
CREATE TYPE "PaymentPlanType" AS ENUM ('MONTHLY_SUBSCRIPTION', 'PERCENTAGE_PER_ORDER');
CREATE TYPE "PaymentStatus" AS ENUM ('ACTIVE', 'WARNING', 'OVERDUE', 'SUSPENDED');

-- 2. Adicionar campos empresariais e operacionais na tabela Partner
ALTER TABLE "Partner" 
  ADD COLUMN IF NOT EXISTS cnpj TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS "companyName" TEXT, -- Razão Social
  ADD COLUMN IF NOT EXISTS "tradingName" TEXT, -- Nome Fantasia
  ADD COLUMN IF NOT EXISTS "stateRegistration" TEXT, -- Inscrição Estadual
  ADD COLUMN IF NOT EXISTS "maxServiceRadius" DOUBLE PRECISION, -- Raio máximo de atendimento em km
  ADD COLUMN IF NOT EXISTS "avgPreparationTime" INTEGER, -- Tempo médio de preparo em minutos
  ADD COLUMN IF NOT EXISTS "operatingHours" JSONB, -- Horários de funcionamento
  ADD COLUMN IF NOT EXISTS "isBlocked" BOOLEAN DEFAULT false; -- Bloqueado se inadimplente

-- Criar índice para CNPJ (busca rápida)
CREATE INDEX IF NOT EXISTS "Partner_cnpj_idx" ON "Partner"(cnpj) WHERE cnpj IS NOT NULL;

-- 3. Criar tabela PartnerPayment
CREATE TABLE IF NOT EXISTS "PartnerPayment" (
  id TEXT PRIMARY KEY,
  "partnerId" TEXT NOT NULL REFERENCES "Partner"(id) ON DELETE CASCADE,
  
  -- Tipo de Plano
  "planType" "PaymentPlanType" NOT NULL,
  "monthlyFee" DOUBLE PRECISION, -- Valor da mensalidade (se MONTHLY_SUBSCRIPTION)
  "percentageFee" DOUBLE PRECISION, -- Percentual por corrida (se PERCENTAGE_PER_ORDER)
  
  -- Status
  status "PaymentStatus" DEFAULT 'ACTIVE',
  "dueDate" TIMESTAMP, -- Data de vencimento
  "lastPaymentDate" TIMESTAMP, -- Último pagamento realizado
  
  -- Histórico de pagamentos (JSON array)
  "paymentHistory" JSONB DEFAULT '[]'::jsonb,
  
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "PartnerPayment_partnerId_idx" ON "PartnerPayment"("partnerId");
CREATE INDEX IF NOT EXISTS "PartnerPayment_status_idx" ON "PartnerPayment"(status);
CREATE INDEX IF NOT EXISTS "PartnerPayment_dueDate_idx" ON "PartnerPayment"("dueDate");
CREATE INDEX IF NOT EXISTS "PartnerPayment_partner_status_idx" ON "PartnerPayment"("partnerId", status);

-- 4. Comentários para documentação
COMMENT ON TYPE "PaymentPlanType" IS 'Tipo de plano: MONTHLY_SUBSCRIPTION (mensal) ou PERCENTAGE_PER_ORDER (por corrida)';
COMMENT ON TYPE "PaymentStatus" IS 'Status do pagamento: ACTIVE, WARNING, OVERDUE, SUSPENDED';

COMMENT ON COLUMN "Partner".cnpj IS 'CNPJ do parceiro (único)';
COMMENT ON COLUMN "Partner"."companyName" IS 'Razão Social';
COMMENT ON COLUMN "Partner"."tradingName" IS 'Nome Fantasia';
COMMENT ON COLUMN "Partner"."stateRegistration" IS 'Inscrição Estadual';
COMMENT ON COLUMN "Partner"."maxServiceRadius" IS 'Raio máximo de atendimento em km';
COMMENT ON COLUMN "Partner"."avgPreparationTime" IS 'Tempo médio de preparo em minutos';
COMMENT ON COLUMN "Partner"."operatingHours" IS 'Horários de funcionamento (JSON: {"monday": {"open": "08:00", "close": "22:00"}, ...})';
COMMENT ON COLUMN "Partner"."isBlocked" IS 'Indica se o parceiro está bloqueado (inadimplente ou suspenso)';

COMMENT ON COLUMN "PartnerPayment"."planType" IS 'Tipo de plano de pagamento';
COMMENT ON COLUMN "PartnerPayment"."monthlyFee" IS 'Valor da mensalidade (se MONTHLY_SUBSCRIPTION)';
COMMENT ON COLUMN "PartnerPayment"."percentageFee" IS 'Percentual por corrida (se PERCENTAGE_PER_ORDER)';
COMMENT ON COLUMN "PartnerPayment".status IS 'Status do pagamento';
COMMENT ON COLUMN "PartnerPayment"."dueDate" IS 'Data de vencimento';
COMMENT ON COLUMN "PartnerPayment"."lastPaymentDate" IS 'Data do último pagamento realizado';
COMMENT ON COLUMN "PartnerPayment"."paymentHistory" IS 'Histórico de pagamentos (JSON array)';

-- ============================================
-- FIM DA MIGRATION FASE 2
-- ============================================
