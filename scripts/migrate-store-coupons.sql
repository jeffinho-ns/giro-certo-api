-- Loja Virtual — Fase 3: cupons de desconto. Idempotente.

CREATE TABLE IF NOT EXISTS "StoreCoupon" (
  id TEXT PRIMARY KEY,
  "partnerId" TEXT NOT NULL REFERENCES "Partner"(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  "discountType" TEXT NOT NULL CHECK ("discountType" IN ('percent', 'fixed')),
  "discountValue" DOUBLE PRECISION NOT NULL,
  "minSubtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "maxUses" INTEGER,
  "usedCount" INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Código único por loja (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS "StoreCoupon_partner_code_key"
  ON "StoreCoupon" ("partnerId", upper(code));

-- Snapshot do cupom aplicado ao pedido.
ALTER TABLE "StoreOrder" ADD COLUMN IF NOT EXISTS "couponCode" TEXT;
ALTER TABLE "StoreOrder" ADD COLUMN IF NOT EXISTS "couponId" TEXT;
ALTER TABLE "StoreOrder" ADD COLUMN IF NOT EXISTS discount DOUBLE PRECISION NOT NULL DEFAULT 0;
