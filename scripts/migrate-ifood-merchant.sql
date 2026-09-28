-- Liga a loja Giro Certo ao merchant do iFood e evita importar o mesmo pedido duas vezes.

ALTER TABLE "Partner"
  ADD COLUMN IF NOT EXISTS "ifoodMerchantId" TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Partner_ifoodMerchantId_uidx"
  ON "Partner" ("ifoodMerchantId")
  WHERE "ifoodMerchantId" IS NOT NULL;

COMMENT ON COLUMN "Partner"."ifoodMerchantId" IS
  'Store/chain ID do iFood. Pedidos com entrega própria (deliveredBy MERCHANT) desta loja viram corrida.';

ALTER TABLE "DeliveryOrder"
  ADD COLUMN IF NOT EXISTS "ifoodOrderId" TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryOrder_ifoodOrderId_uidx"
  ON "DeliveryOrder" ("ifoodOrderId")
  WHERE "ifoodOrderId" IS NOT NULL;

COMMENT ON COLUMN "DeliveryOrder"."ifoodOrderId" IS
  'ID do pedido no iFood, quando a corrida nasceu de uma entrega própria.';
