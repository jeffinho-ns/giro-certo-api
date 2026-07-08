-- Loja Virtual — gestão admin da loja (modo giro_managed + auditoria).
-- Idempotente.

ALTER TABLE "Partner"
  ADD COLUMN IF NOT EXISTS "storeManagementMode" TEXT NOT NULL DEFAULT 'self';

DO $$ BEGIN
  ALTER TABLE "Partner"
    ADD CONSTRAINT "Partner_storeManagementMode_check"
    CHECK ("storeManagementMode" IN ('self', 'giro_managed'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "StoreAuditLog" (
  id TEXT PRIMARY KEY,
  "partnerId" TEXT NOT NULL REFERENCES "Partner"(id) ON DELETE CASCADE,
  "actorUserId" TEXT REFERENCES "User"(id) ON DELETE SET NULL,
  "actorRole" TEXT NOT NULL,
  action TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  summary TEXT,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "StoreAuditLog_partnerId_idx" ON "StoreAuditLog"("partnerId");
CREATE INDEX IF NOT EXISTS "StoreAuditLog_createdAt_idx" ON "StoreAuditLog"("createdAt" DESC);
