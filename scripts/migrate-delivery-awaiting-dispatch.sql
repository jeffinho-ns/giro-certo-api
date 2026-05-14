DO $$ BEGIN
  ALTER TYPE "DeliveryStatus" ADD VALUE 'awaiting_dispatch';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
