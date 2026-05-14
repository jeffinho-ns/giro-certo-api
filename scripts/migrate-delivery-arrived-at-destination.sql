DO $$ BEGIN
  ALTER TYPE "DeliveryStatus" ADD VALUE 'arrivedAtDestination';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "DeliveryOrder"
  ADD COLUMN IF NOT EXISTS "arrived_at_destination_at" TIMESTAMP;
