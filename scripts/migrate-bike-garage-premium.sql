-- Campos premium da garagem para personalização e galeria de fotos
ALTER TABLE "Bike"
  ADD COLUMN IF NOT EXISTS nickname TEXT,
  ADD COLUMN IF NOT EXISTS "ridingStyle" TEXT,
  ADD COLUMN IF NOT EXISTS accessories TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "nextUpgrade" TEXT,
  ADD COLUMN IF NOT EXISTS "preferredColor" TEXT,
  ADD COLUMN IF NOT EXISTS "galleryUrls" TEXT[] DEFAULT '{}';

UPDATE "Bike"
SET accessories = COALESCE(accessories, '{}'),
    "galleryUrls" = COALESCE("galleryUrls", '{}')
WHERE accessories IS NULL OR "galleryUrls" IS NULL;
