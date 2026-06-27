-- Loja Virtual — Fase 3: avaliação da loja. Idempotente.

CREATE TABLE IF NOT EXISTS "StoreReview" (
  id TEXT PRIMARY KEY,
  "partnerId" TEXT NOT NULL REFERENCES "Partner"(id) ON DELETE CASCADE,
  "storeOrderId" TEXT REFERENCES "StoreOrder"(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  "customerName" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Uma avaliação por pedido.
CREATE UNIQUE INDEX IF NOT EXISTS "StoreReview_order_key" ON "StoreReview" ("storeOrderId");
CREATE INDEX IF NOT EXISTS "StoreReview_partner_idx" ON "StoreReview" ("partnerId", "createdAt" DESC);
