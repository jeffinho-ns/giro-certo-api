-- Fase 1: cobrança cliente final via Asaas + política de cobrança por loja.
-- Execute após backup: npm run db:migrate:delivery-payment

ALTER TABLE "Partner"
  ADD COLUMN IF NOT EXISTS "delivery_payment_collection_mode" TEXT NOT NULL DEFAULT 'prepaid';

ALTER TABLE "Partner"
  DROP CONSTRAINT IF EXISTS "Partner_delivery_payment_collection_mode_check";

ALTER TABLE "Partner"
  ADD CONSTRAINT "Partner_delivery_payment_collection_mode_check"
  CHECK ("delivery_payment_collection_mode" IN ('prepaid', 'postpaid_pix', 'authorize_capture'));

CREATE TABLE IF NOT EXISTS "DeliveryPayment" (
  id TEXT PRIMARY KEY,
  "deliveryOrderId" TEXT NOT NULL REFERENCES "DeliveryOrder"(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  "collectionMode" TEXT NOT NULL DEFAULT 'prepaid',
  "customerTotal" DOUBLE PRECISION NOT NULL,
  "itemValueSnapshot" DOUBLE PRECISION NOT NULL,
  "deliveryFeeSnapshot" DOUBLE PRECISION NOT NULL,
  "platformFeeStore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "platformFeeRider" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "storeNetSnapshot" DOUBLE PRECISION NOT NULL,
  "riderNetSnapshot" DOUBLE PRECISION NOT NULL,
  currency TEXT NOT NULL DEFAULT 'BRL',
  "idempotencyKey" TEXT UNIQUE NOT NULL,
  "asaasPaymentId" TEXT UNIQUE,
  "asaasCustomerId" TEXT,
  "invoiceUrl" TEXT,
  "bankSlipUrl" TEXT,
  "billingTypeRequested" TEXT,
  "lastWebhookEvent" TEXT,
  "lastWebhookPayload" JSONB,
  "paidAt" TIMESTAMP,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW(),
  CONSTRAINT "DeliveryPayment_status_check" CHECK (
    status IN (
      'pending',
      'checkout_created',
      'paid',
      'confirmed_processing',
      'failed',
      'refunded',
      'cancelled',
      'expired'
    )
  ),
  CONSTRAINT "DeliveryPayment_collection_mode_check" CHECK (
    "collectionMode" IN ('prepaid', 'postpaid_pix', 'authorize_capture')
  )
);

CREATE INDEX IF NOT EXISTS "DeliveryPayment_deliveryOrderId_idx"
  ON "DeliveryPayment"("deliveryOrderId");

CREATE INDEX IF NOT EXISTS "DeliveryPayment_status_idx"
  ON "DeliveryPayment"(status);

CREATE INDEX IF NOT EXISTS "DeliveryPayment_asaasPaymentId_idx"
  ON "DeliveryPayment"("asaasPaymentId");
