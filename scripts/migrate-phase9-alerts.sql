-- ============================================
-- FASE 9: Sistema de Alertas e Notificações
-- ============================================

-- Criar enums
DO $$ BEGIN
    CREATE TYPE "AlertType" AS ENUM ('DOCUMENT_EXPIRING', 'MAINTENANCE_CRITICAL', 'PAYMENT_OVERDUE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "AlertSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Criar tabela Alert
CREATE TABLE IF NOT EXISTS "Alert" (
  id TEXT PRIMARY KEY,
  type "AlertType" NOT NULL,
  severity "AlertSeverity" NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  "userId" TEXT REFERENCES "User"(id) ON DELETE CASCADE, -- Se relacionado a um usuário
  "partnerId" TEXT REFERENCES "Partner"(id) ON DELETE CASCADE, -- Se relacionado a um parceiro
  "isRead" BOOLEAN DEFAULT false,
  "readAt" TIMESTAMP,
  
  "createdAt" TIMESTAMP DEFAULT NOW()
);

-- Criar índices
CREATE INDEX IF NOT EXISTS "Alert_userId_idx" ON "Alert"("userId");
CREATE INDEX IF NOT EXISTS "Alert_partnerId_idx" ON "Alert"("partnerId");
CREATE INDEX IF NOT EXISTS "Alert_type_idx" ON "Alert"(type);
CREATE INDEX IF NOT EXISTS "Alert_isRead_idx" ON "Alert"("isRead");
CREATE INDEX IF NOT EXISTS "Alert_severity_idx" ON "Alert"(severity);
CREATE INDEX IF NOT EXISTS "Alert_createdAt_idx" ON "Alert"("createdAt" DESC);

-- Comentários
COMMENT ON TYPE "AlertType" IS 'Tipo de alerta: DOCUMENT_EXPIRING (documento expirando), MAINTENANCE_CRITICAL (manutenção crítica), PAYMENT_OVERDUE (pagamento atrasado)';
COMMENT ON TYPE "AlertSeverity" IS 'Severidade do alerta: LOW (baixa), MEDIUM (média), HIGH (alta), CRITICAL (crítica)';
COMMENT ON TABLE "Alert" IS 'Sistema de alertas e notificações do sistema';
COMMENT ON COLUMN "Alert".type IS 'Tipo do alerta';
COMMENT ON COLUMN "Alert".severity IS 'Severidade do alerta';
COMMENT ON COLUMN "Alert".title IS 'Título do alerta';
COMMENT ON COLUMN "Alert".message IS 'Mensagem detalhada do alerta';
COMMENT ON COLUMN "Alert"."userId" IS 'ID do usuário relacionado (se aplicável)';
COMMENT ON COLUMN "Alert"."partnerId" IS 'ID do parceiro relacionado (se aplicável)';
COMMENT ON COLUMN "Alert"."isRead" IS 'Indica se o alerta foi lido';
COMMENT ON COLUMN "Alert"."readAt" IS 'Data/hora em que o alerta foi lido';
