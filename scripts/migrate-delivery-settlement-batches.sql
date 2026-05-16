-- Fase 2 — lotes de liquidação + vínculos no livro. Execute após migrate-delivery-settlement-ledger.
-- npm run db:migrate:delivery-settlement-batches

ALTER TABLE "Partner"
  ADD COLUMN IF NOT EXISTS "delivery_settlement_frequency" TEXT NOT NULL DEFAULT 'weekly';

ALTER TABLE "Partner"
  DROP CONSTRAINT IF EXISTS "Partner_delivery_settlement_frequency_check";

ALTER TABLE "Partner"
  ADD CONSTRAINT "Partner_delivery_settlement_frequency_check"
  CHECK ("delivery_settlement_frequency" IN ('daily', 'weekly', 'monthly'));

ALTER TABLE "Partner"
  ADD COLUMN IF NOT EXISTS "delivery_settlement_fee_flat_override" DOUBLE PRECISION NULL;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "delivery_settlement_frequency" TEXT NULL;

ALTER TABLE "User"
  DROP CONSTRAINT IF EXISTS "User_delivery_settlement_frequency_check";

ALTER TABLE "User"
  ADD CONSTRAINT "User_delivery_settlement_frequency_check"
  CHECK (
    "delivery_settlement_frequency" IS NULL
    OR "delivery_settlement_frequency" IN ('daily', 'weekly', 'monthly')
  );

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "delivery_settlement_fee_flat_override" DOUBLE PRECISION NULL;

CREATE TABLE IF NOT EXISTS "DeliverySettlementBatch" (
  id TEXT PRIMARY KEY,
  beneficiary_type TEXT NOT NULL,
  partner_id TEXT REFERENCES "Partner"(id) ON DELETE RESTRICT,
  rider_user_id TEXT REFERENCES "User"(id) ON DELETE RESTRICT,
  gross_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  settlement_fee_flat DOUBLE PRECISION NOT NULL DEFAULT 0,
  net_payable DOUBLE PRECISION NOT NULL DEFAULT 0,
  line_count INT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'BRL',
  settlement_frequency TEXT NOT NULL DEFAULT 'weekly',
  status TEXT NOT NULL DEFAULT 'pending_transfer',
  asaas_transfer_id TEXT NULL,
  external_reference TEXT NULL,
  notes TEXT NULL,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW(),
  CONSTRAINT "DeliverySettlementBatch_beneficiary_chk" CHECK (
    (
      beneficiary_type = 'partner'
      AND partner_id IS NOT NULL
      AND rider_user_id IS NULL
    )
    OR (
      beneficiary_type = 'rider'
      AND rider_user_id IS NOT NULL
      AND partner_id IS NULL
    )
  ),
  CONSTRAINT "DeliverySettlementBatch_status_check" CHECK (
    status IN (
      'pending_transfer',
      'no_transfer',
      'transfer_requested',
      'transfer_done',
      'transfer_failed',
      'cancelled'
    )
  ),
  CONSTRAINT "DeliverySettlementBatch_beneficiary_type_check" CHECK (
    beneficiary_type IN ('partner', 'rider')
  )
);

CREATE INDEX IF NOT EXISTS "DeliverySettlementBatch_status_idx"
  ON "DeliverySettlementBatch"(status);

CREATE INDEX IF NOT EXISTS "DeliverySettlementBatch_partner_id_idx"
  ON "DeliverySettlementBatch"(partner_id)
  WHERE partner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS "DeliverySettlementBatch_rider_user_id_idx"
  ON "DeliverySettlementBatch"(rider_user_id)
  WHERE rider_user_id IS NOT NULL;

COMMENT ON TABLE "DeliverySettlementBatch" IS
  'Lote agregando linhas do DeliverySettlementLedger; transferência física via Asaas (opcional).';

ALTER TABLE "DeliverySettlementLedger"
  ADD COLUMN IF NOT EXISTS settlement_batch_id TEXT NULL REFERENCES "DeliverySettlementBatch"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "DeliverySettlementLedger_settlement_batch_id_idx"
  ON "DeliverySettlementLedger"(settlement_batch_id);
