-- Novo tipo de alerta para operação logística
DO $$ BEGIN
  ALTER TYPE "AlertType" ADD VALUE 'DELIVERY_ARRIVED_AT_STORE';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

