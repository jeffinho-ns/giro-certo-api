-- Equipamentos enviados no cadastro + comprovante opcional (nota/canhotto) para bike
ALTER TABLE "DeliveryRegistration"
ADD COLUMN IF NOT EXISTS equipments TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "DeliveryRegistration"
ADD COLUMN IF NOT EXISTS "bikeOptionalReceiptData" BYTEA;

COMMENT ON COLUMN "DeliveryRegistration".equipments IS 'Chips de equipamento (mochila, etc.)';
COMMENT ON COLUMN "DeliveryRegistration"."bikeOptionalReceiptData" IS 'Foto opcional: nota fiscal ou canhoto da bike';
