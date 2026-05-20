-- Permite lote de loja e lote de rider na mesma linha do livro (antes um batch_id bloqueava o motoboy).

ALTER TABLE "DeliverySettlementLedger"
  ADD COLUMN IF NOT EXISTS partner_settlement_batch_id TEXT NULL
    REFERENCES "DeliverySettlementBatch"(id) ON DELETE SET NULL;

ALTER TABLE "DeliverySettlementLedger"
  ADD COLUMN IF NOT EXISTS rider_settlement_batch_id TEXT NULL
    REFERENCES "DeliverySettlementBatch"(id) ON DELETE SET NULL;

UPDATE "DeliverySettlementLedger"
SET partner_settlement_batch_id = settlement_batch_id
WHERE settlement_batch_id IS NOT NULL
  AND partner_settlement_batch_id IS NULL;

CREATE INDEX IF NOT EXISTS "DeliverySettlementLedger_partner_batch_idx"
  ON "DeliverySettlementLedger"(partner_settlement_batch_id);

CREATE INDEX IF NOT EXISTS "DeliverySettlementLedger_rider_batch_idx"
  ON "DeliverySettlementLedger"(rider_settlement_batch_id);
