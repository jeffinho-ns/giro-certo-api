-- ============================================
-- MIGRATION: Loja Virtual (Giro Certo) — Fase 1 (modelo de dados)
-- Documento mestre: PLANO_LOJA_VIRTUAL.md (Seção 6)
-- Descrição: catálogo (categorias/produtos/variações), banners, cliente leve,
--            pedido de compra (StoreOrder) + itens, e ponte com DeliveryOrder.
-- Execute após backup: npm run db:migrate:loja-virtual
-- Idempotente: pode ser reexecutada com segurança (IF NOT EXISTS).
-- IDs são TEXT, gerados na aplicação (utils/id.generateId()).
-- ============================================

-- ============================================
-- 1. Catálogo: Categorias
-- ============================================
CREATE TABLE IF NOT EXISTS "ProductCategory" (
  id TEXT PRIMARY KEY,
  "partnerId" TEXT NOT NULL REFERENCES "Partner"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "ProductCategory_partnerId_idx" ON "ProductCategory"("partnerId");
CREATE INDEX IF NOT EXISTS "ProductCategory_partner_active_idx" ON "ProductCategory"("partnerId", active);

-- ============================================
-- 2. Catálogo: Produtos
-- ============================================
CREATE TABLE IF NOT EXISTS "Product" (
  id TEXT PRIMARY KEY,
  "partnerId" TEXT NOT NULL REFERENCES "Partner"(id) ON DELETE CASCADE,
  "categoryId" TEXT REFERENCES "ProductCategory"(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  "basePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "photoUrl" TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "Product_partnerId_idx" ON "Product"("partnerId");
CREATE INDEX IF NOT EXISTS "Product_categoryId_idx" ON "Product"("categoryId");
CREATE INDEX IF NOT EXISTS "Product_partner_active_idx" ON "Product"("partnerId", active);

-- ============================================
-- 3. Catálogo: Grupos de opções (variações) — ex.: "Tamanho", "Adicionais"
-- ============================================
CREATE TABLE IF NOT EXISTS "ProductOptionGroup" (
  id TEXT PRIMARY KEY,
  "productId" TEXT NOT NULL REFERENCES "Product"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  "minSelect" INTEGER NOT NULL DEFAULT 0,
  "maxSelect" INTEGER NOT NULL DEFAULT 1,
  required BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW(),
  CONSTRAINT "ProductOptionGroup_minmax_check" CHECK ("minSelect" >= 0 AND "maxSelect" >= "minSelect")
);

CREATE INDEX IF NOT EXISTS "ProductOptionGroup_productId_idx" ON "ProductOptionGroup"("productId");

-- ============================================
-- 4. Catálogo: Opções dentro de um grupo — ex.: "Grande +R$5", "Bacon +R$3"
-- ============================================
CREATE TABLE IF NOT EXISTS "ProductOption" (
  id TEXT PRIMARY KEY,
  "optionGroupId" TEXT NOT NULL REFERENCES "ProductOptionGroup"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  "priceDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "ProductOption_optionGroupId_idx" ON "ProductOption"("optionGroupId");

-- ============================================
-- 5. Banners / Promoções da vitrine
-- ============================================
CREATE TABLE IF NOT EXISTS "StoreBanner" (
  id TEXT PRIMARY KEY,
  "partnerId" TEXT NOT NULL REFERENCES "Partner"(id) ON DELETE CASCADE,
  "imageUrl" TEXT NOT NULL,
  title TEXT,
  "linkUrl" TEXT,
  discount DOUBLE PRECISION,
  "startsAt" TIMESTAMP,
  "endsAt" TIMESTAMP,
  active BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "StoreBanner_partnerId_idx" ON "StoreBanner"("partnerId");
CREATE INDEX IF NOT EXISTS "StoreBanner_partner_active_idx" ON "StoreBanner"("partnerId", active);

-- ============================================
-- 6. Cliente leve (sem login) — apenas reaproveitamento de dados
-- ============================================
CREATE TABLE IF NOT EXISTS "StoreCustomer" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "StoreCustomer_phone_idx" ON "StoreCustomer"(phone);

-- ============================================
-- 7. Pedido de compra (StoreOrder)
-- Snapshots dos dados do cliente e dos valores (servidor é a fonte da verdade).
-- ============================================
CREATE TABLE IF NOT EXISTS "StoreOrder" (
  id TEXT PRIMARY KEY,
  "partnerId" TEXT NOT NULL REFERENCES "Partner"(id) ON DELETE CASCADE,
  "customerId" TEXT REFERENCES "StoreCustomer"(id) ON DELETE SET NULL,

  -- Snapshot dos dados do cliente (LGPD: visível só ao lojista dono + admin)
  "customerName" TEXT NOT NULL,
  "customerPhone" TEXT NOT NULL,
  "customerAddress" TEXT NOT NULL,
  "customerLatitude" DOUBLE PRECISION,
  "customerLongitude" DOUBLE PRECISION,
  notes TEXT,

  -- Valores (sempre recalculados no servidor; cliente nunca envia preço)
  subtotal DOUBLE PRECISION NOT NULL DEFAULT 0,
  "deliveryFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
  total DOUBLE PRECISION NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'BRL',

  -- Ciclo de vida
  status TEXT NOT NULL DEFAULT 'awaiting_payment',

  -- Pagamento (Asaas / DeliveryPayment). Despacho só após webhook confirmar 'paid'.
  "paymentId" TEXT,

  -- Ponte com a logística existente
  "deliveryOrderId" TEXT REFERENCES "DeliveryOrder"(id) ON DELETE SET NULL,

  -- Acompanhamento pelo cliente anônimo (token não sequencial)
  "trackingToken" TEXT UNIQUE NOT NULL,

  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW(),
  "paidAt" TIMESTAMP,
  "acceptedAt" TIMESTAMP,
  "dispatchedAt" TIMESTAMP,
  "completedAt" TIMESTAMP,
  "cancelledAt" TIMESTAMP,

  CONSTRAINT "StoreOrder_status_check" CHECK (
    status IN (
      'awaiting_payment',
      'paid',
      'accepted_by_store',
      'dispatched',
      'in_delivery',
      'completed',
      'cancelled',
      'rejected'
    )
  )
);

CREATE INDEX IF NOT EXISTS "StoreOrder_partnerId_idx" ON "StoreOrder"("partnerId");
CREATE INDEX IF NOT EXISTS "StoreOrder_status_idx" ON "StoreOrder"(status);
CREATE INDEX IF NOT EXISTS "StoreOrder_partner_status_idx" ON "StoreOrder"("partnerId", status);
CREATE INDEX IF NOT EXISTS "StoreOrder_deliveryOrderId_idx" ON "StoreOrder"("deliveryOrderId");
CREATE INDEX IF NOT EXISTS "StoreOrder_trackingToken_idx" ON "StoreOrder"("trackingToken");

-- ============================================
-- 8. Itens do pedido (com variações escolhidas — snapshot em JSON)
-- ============================================
CREATE TABLE IF NOT EXISTS "StoreOrderItem" (
  id TEXT PRIMARY KEY,
  "storeOrderId" TEXT NOT NULL REFERENCES "StoreOrder"(id) ON DELETE CASCADE,
  "productId" TEXT REFERENCES "Product"(id) ON DELETE SET NULL,

  -- Snapshot do item no momento da compra
  name TEXT NOT NULL,
  "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 1,
  -- [{ groupName, optionName, priceDelta }, ...]
  "selectedOptions" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "lineTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  notes TEXT,

  "createdAt" TIMESTAMP DEFAULT NOW(),

  CONSTRAINT "StoreOrderItem_quantity_check" CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS "StoreOrderItem_storeOrderId_idx" ON "StoreOrderItem"("storeOrderId");
CREATE INDEX IF NOT EXISTS "StoreOrderItem_productId_idx" ON "StoreOrderItem"("productId");

-- ============================================
-- 9. Ponte reversa: DeliveryOrder -> StoreOrder
-- Liga a logística ao pedido de compra (leva itens ao app/portal do lojista).
-- ============================================
ALTER TABLE "DeliveryOrder"
  ADD COLUMN IF NOT EXISTS "storeOrderId" TEXT REFERENCES "StoreOrder"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "DeliveryOrder_storeOrderId_idx" ON "DeliveryOrder"("storeOrderId");

-- ============================================
-- 10. Comentários (documentação)
-- ============================================
COMMENT ON TABLE "ProductCategory" IS 'Seções da vitrine (Lanches, Bebidas...). Escopado por partnerId.';
COMMENT ON TABLE "Product" IS 'Item base do catálogo do lojista. Escopado por partnerId.';
COMMENT ON TABLE "ProductOptionGroup" IS 'Grupo de variações de um produto (ex.: Tamanho 1 obrigatório, Adicionais 0-N).';
COMMENT ON TABLE "ProductOption" IS 'Opção dentro de um grupo, com priceDelta somado ao preço base.';
COMMENT ON TABLE "StoreBanner" IS 'Banners/promoções da vitrine do lojista.';
COMMENT ON TABLE "StoreCustomer" IS 'Cliente final sem login; apenas reaproveita nome/telefone/endereço.';
COMMENT ON TABLE "StoreOrder" IS 'Pedido de compra da loja virtual. Vira DeliveryOrder no aceite do lojista (após pagamento).';
COMMENT ON TABLE "StoreOrderItem" IS 'Itens do pedido com variações escolhidas (snapshot de nome/preço/opções).';

COMMENT ON COLUMN "StoreOrder".status IS 'awaiting_payment -> paid -> accepted_by_store -> dispatched -> in_delivery -> completed (+ cancelled / rejected)';
COMMENT ON COLUMN "StoreOrder"."paymentId" IS 'Referência ao pagamento (Asaas/DeliveryPayment). Despacho só após webhook confirmar pago.';
COMMENT ON COLUMN "StoreOrder"."trackingToken" IS 'Token aleatório/não sequencial para acompanhamento anônimo do pedido.';
COMMENT ON COLUMN "StoreOrder"."deliveryOrderId" IS 'Entrega gerada a partir deste pedido (pipeline de logística existente).';
COMMENT ON COLUMN "DeliveryOrder"."storeOrderId" IS 'Pedido de compra de origem (loja virtual), quando aplicável.';
COMMENT ON COLUMN "StoreOrderItem"."selectedOptions" IS 'Snapshot JSON das variações escolhidas: [{groupName, optionName, priceDelta}].';

-- ============================================
-- FIM DA MIGRATION — Loja Virtual (Fase 1)
-- ============================================
