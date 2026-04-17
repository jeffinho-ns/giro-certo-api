-- Atualiza o fluxo de status de entrega para maior granularidade
-- 1) Adiciona valores no enum DeliveryStatus
-- 2) Adiciona timestamps de chegada na loja e início de trânsito

DO $$ BEGIN
  ALTER TYPE "DeliveryStatus" ADD VALUE 'arrivedAtStore';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TYPE "DeliveryStatus" ADD VALUE 'inTransit';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "DeliveryOrder"
  ADD COLUMN IF NOT EXISTS "arrived_at_store_at" TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "in_transit_at" TIMESTAMP;

