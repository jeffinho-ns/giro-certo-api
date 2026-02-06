-- Adicionar colunas BYTEA para armazenar imagens diretamente no banco
ALTER TABLE "DeliveryRegistration"
ADD COLUMN IF NOT EXISTS "selfieWithDocData" BYTEA,
ADD COLUMN IF NOT EXISTS "motoWithPlateData" BYTEA,
ADD COLUMN IF NOT EXISTS "platePlateCloseupData" BYTEA,
ADD COLUMN IF NOT EXISTS "cnhPhotoData" BYTEA,
ADD COLUMN IF NOT EXISTS "crlvPhotoData" BYTEA;

-- Remover as colunas de URL se ainda estiverem lá
ALTER TABLE "DeliveryRegistration"
DROP COLUMN IF EXISTS "selfieWithDocUrl",
DROP COLUMN IF EXISTS "motoWithPlateUrl",
DROP COLUMN IF EXISTS "platePlateCloseupUrl",
DROP COLUMN IF EXISTS "cnhPhotoUrl",
DROP COLUMN IF EXISTS "crlvPhotoUrl";
