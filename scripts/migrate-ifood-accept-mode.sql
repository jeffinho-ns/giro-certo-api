-- Escolha da loja: esperar o aceite no iFood ou o Giro Certo aceitar na hora.

ALTER TABLE "Partner"
  ADD COLUMN IF NOT EXISTS "ifoodAcceptMode" TEXT NOT NULL DEFAULT 'after_ifood_accept';

ALTER TABLE "Partner"
  DROP CONSTRAINT IF EXISTS "Partner_ifoodAcceptMode_check";

ALTER TABLE "Partner"
  ADD CONSTRAINT "Partner_ifoodAcceptMode_check"
  CHECK ("ifoodAcceptMode" IN ('after_ifood_accept', 'immediate'));

COMMENT ON COLUMN "Partner"."ifoodAcceptMode" IS
  'after_ifood_accept: motoboy só entra depois que o gerente aceita no iFood. immediate: Giro Certo confirma e chama o motoboy assim que o pedido chega.';
