-- ============================================
-- MIGRATION: pagamento Asaas no StoreOrder + CPF do cliente
-- Loja Virtual — Passo 4. Guarda dados da cobrança e o CPF/CNPJ do pagador.
-- Execute: npm run db:migrate:store-order-payment
-- Idempotente.
-- ============================================

ALTER TABLE "StoreOrder"
  ADD COLUMN IF NOT EXISTS "customerCpf" TEXT,
  ADD COLUMN IF NOT EXISTS "asaasPaymentId" TEXT,
  ADD COLUMN IF NOT EXISTS "asaasCustomerId" TEXT,
  ADD COLUMN IF NOT EXISTS "invoiceUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "billingType" TEXT,
  ADD COLUMN IF NOT EXISTS "lastWebhookEvent" TEXT,
  ADD COLUMN IF NOT EXISTS "lastWebhookPayload" JSONB;

CREATE INDEX IF NOT EXISTS "StoreOrder_asaasPaymentId_idx"
  ON "StoreOrder"("asaasPaymentId") WHERE "asaasPaymentId" IS NOT NULL;

COMMENT ON COLUMN "StoreOrder"."customerCpf" IS 'CPF/CNPJ do pagador (somente dígitos) — exigido pelo Asaas.';
COMMENT ON COLUMN "StoreOrder"."asaasPaymentId" IS 'ID da cobrança Asaas vinculada ao pedido.';
COMMENT ON COLUMN "StoreOrder"."invoiceUrl" IS 'URL da fatura/checkout Asaas para o cliente pagar.';
