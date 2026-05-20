-- CPF/CNPJ do destinatário (pagador Asaas na cobrança do pedido)

ALTER TABLE "DeliveryOrder"
  ADD COLUMN IF NOT EXISTS "recipientCpf" TEXT NULL;

COMMENT ON COLUMN "DeliveryOrder"."recipientCpf" IS
  'CPF ou CNPJ do cliente pagador (somente dígitos; usado ao criar cliente/cobrança Asaas).';
