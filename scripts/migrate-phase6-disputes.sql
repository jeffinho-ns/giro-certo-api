-- ============================================
-- FASE 6: Central de Disputas
-- ============================================

-- Criar enums
DO $$ BEGIN
    CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "DisputeType" AS ENUM ('DELIVERY_ISSUE', 'PAYMENT_ISSUE', 'RIDER_COMPLAINT', 'STORE_COMPLAINT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Criar tabela Dispute
CREATE TABLE IF NOT EXISTS "Dispute" (
  id TEXT PRIMARY KEY,
  "deliveryOrderId" TEXT REFERENCES "DeliveryOrder"(id) ON DELETE SET NULL,
  "reportedBy" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "disputeType" "DisputeType" NOT NULL,
  status "DisputeStatus" DEFAULT 'OPEN',
  description TEXT NOT NULL,
  resolution TEXT, -- Resolução do admin
  "resolvedBy" TEXT REFERENCES "User"(id) ON DELETE SET NULL, -- ID do admin
  "resolvedAt" TIMESTAMP,
  
  -- Logs de geolocalização (se aplicável)
  "locationLogs" JSONB, -- Array de pontos GPS: [{"lat": -23.5505, "lng": -46.6333, "timestamp": "2024-01-01T10:00:00Z"}, ...]
  
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

-- Criar índices
CREATE INDEX IF NOT EXISTS "Dispute_deliveryOrderId_idx" ON "Dispute"("deliveryOrderId");
CREATE INDEX IF NOT EXISTS "Dispute_status_idx" ON "Dispute"(status);
CREATE INDEX IF NOT EXISTS "Dispute_disputeType_idx" ON "Dispute"("disputeType");
CREATE INDEX IF NOT EXISTS "Dispute_reportedBy_idx" ON "Dispute"("reportedBy");
CREATE INDEX IF NOT EXISTS "Dispute_createdAt_idx" ON "Dispute"("createdAt" DESC);

-- Comentários
COMMENT ON TYPE "DisputeStatus" IS 'Status da disputa: OPEN (aberta), UNDER_REVIEW (em análise), RESOLVED (resolvida), CLOSED (fechada)';
COMMENT ON TYPE "DisputeType" IS 'Tipo de disputa: DELIVERY_ISSUE (problema na entrega), PAYMENT_ISSUE (problema de pagamento), RIDER_COMPLAINT (reclamação sobre entregador), STORE_COMPLAINT (reclamação sobre loja)';
COMMENT ON TABLE "Dispute" IS 'Central de disputas para mediação de conflitos';
COMMENT ON COLUMN "Dispute"."deliveryOrderId" IS 'ID do pedido relacionado (opcional)';
COMMENT ON COLUMN "Dispute"."reportedBy" IS 'ID do usuário que reportou a disputa';
COMMENT ON COLUMN "Dispute"."disputeType" IS 'Tipo da disputa';
COMMENT ON COLUMN "Dispute".status IS 'Status atual da disputa';
COMMENT ON COLUMN "Dispute".description IS 'Descrição detalhada da disputa';
COMMENT ON COLUMN "Dispute".resolution IS 'Resolução aplicada pelo admin';
COMMENT ON COLUMN "Dispute"."resolvedBy" IS 'ID do admin que resolveu a disputa';
COMMENT ON COLUMN "Dispute"."resolvedAt" IS 'Data/hora da resolução';
COMMENT ON COLUMN "Dispute"."locationLogs" IS 'Logs de geolocalização (array JSON de pontos GPS)';
