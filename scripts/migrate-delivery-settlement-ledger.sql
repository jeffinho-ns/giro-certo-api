-- Fase 2 — livro de repasses lógicos após pagamento Asaas confirmado.
-- Execute: npm run db:migrate:delivery-settlement-ledger

CREATE TABLE IF NOT EXISTS "DeliverySettlementLedger" (
  id TEXT PRIMARY KEY,
  "deliveryPaymentId" TEXT NOT NULL UNIQUE REFERENCES "DeliveryPayment"(id) ON DELETE CASCADE,
  "deliveryOrderId" TEXT NOT NULL REFERENCES "DeliveryOrder"(id) ON DELETE RESTRICT,
  "storeId" TEXT NOT NULL REFERENCES "Partner"(id) ON DELETE RESTRICT,
  "riderUserId" TEXT REFERENCES "User"(id) ON DELETE SET NULL,
  "storeNetAmount" DOUBLE PRECISION NOT NULL,
  "riderNetAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "platformFeeStore" DOUBLE PRECISION NOT NULL,
  "platformFeeRider" DOUBLE PRECISION NOT NULL,
  "customerTotal" DOUBLE PRECISION NOT NULL,
  currency TEXT NOT NULL DEFAULT 'BRL',
  settlement_status TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW(),
  CONSTRAINT "DeliverySettlementLedger_settlement_status_check" CHECK (
    settlement_status IN ('pending', 'batched', 'settled', 'void')
  )
);

CREATE INDEX IF NOT EXISTS "DeliverySettlementLedger_storeId_settlement_status_idx"
  ON "DeliverySettlementLedger"("storeId", settlement_status);

CREATE INDEX IF NOT EXISTS "DeliverySettlementLedger_riderUserId_settlement_status_idx"
  ON "DeliverySettlementLedger"("riderUserId", settlement_status)
  WHERE "riderUserId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "DeliverySettlementLedger_deliveryOrderId_idx"
  ON "DeliverySettlementLedger"("deliveryOrderId");

COMMENT ON TABLE "DeliverySettlementLedger" IS
  'Snapshot de repasse após DeliveryPayment paid; transferência física Asaas em fase posterior.';
