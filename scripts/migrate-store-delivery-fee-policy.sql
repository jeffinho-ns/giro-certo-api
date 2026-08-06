-- Política de frete da loja virtual (fixo / distância com teto / distância automática).
-- Idempotente.

ALTER TABLE "Partner"
  ADD COLUMN IF NOT EXISTS "store_delivery_fee_mode" TEXT NOT NULL DEFAULT 'distance_capped';

ALTER TABLE "Partner"
  DROP CONSTRAINT IF EXISTS "Partner_store_delivery_fee_mode_check";

ALTER TABLE "Partner"
  ADD CONSTRAINT "Partner_store_delivery_fee_mode_check"
  CHECK ("store_delivery_fee_mode" IN ('fixed', 'distance_capped', 'distance'));

ALTER TABLE "Partner"
  ADD COLUMN IF NOT EXISTS "store_delivery_fee_max" DOUBLE PRECISION;

ALTER TABLE "Partner"
  ADD COLUMN IF NOT EXISTS "store_delivery_fee_fixed" DOUBLE PRECISION;

COMMENT ON COLUMN "Partner"."store_delivery_fee_mode" IS
  'fixed = valor fixo; distance_capped = por distância até store_delivery_fee_max; distance = por distância sem teto';

COMMENT ON COLUMN "Partner"."store_delivery_fee_max" IS
  'Teto máximo de frete pago pela loja (R$). Obrigatório em distance_capped.';

COMMENT ON COLUMN "Partner"."store_delivery_fee_fixed" IS
  'Frete fixo (R$) quando store_delivery_fee_mode = fixed.';
