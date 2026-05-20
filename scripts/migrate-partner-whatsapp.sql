-- WhatsApp Cloud API: número da loja no Meta → Partner

ALTER TABLE "Partner"
  ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id TEXT NULL;

ALTER TABLE "Partner"
  ADD COLUMN IF NOT EXISTS whatsapp_orders_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "Partner".whatsapp_phone_number_id IS
  'ID do número no Meta WhatsApp Cloud API (metadata.phone_number_id do webhook).';

COMMENT ON COLUMN "Partner".whatsapp_orders_enabled IS
  'Se true, mensagens no formato de pedido neste número criam DeliveryOrder e enviam link de pagamento.';
