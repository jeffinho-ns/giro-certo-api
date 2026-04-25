-- Tipo de veículo no cadastro de delivery (moto x bicicleta) para análise no painel
ALTER TABLE "DeliveryRegistration"
ADD COLUMN IF NOT EXISTS "vehicleType" VARCHAR(20) NOT NULL DEFAULT 'MOTORCYCLE';

COMMENT ON COLUMN "DeliveryRegistration"."vehicleType" IS 'MOTORCYCLE ou BICYCLE';
