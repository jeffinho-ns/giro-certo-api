-- Bloqueia entregador no matching / aceite de corridas (ex.: inadimplência administrativa)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deliveryRiderBlocked" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "User"."deliveryRiderBlocked" IS 'Se true, não recebe ofertas de corridas e não pode aceitar (inadimplência, etc.)';
