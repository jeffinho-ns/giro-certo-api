CREATE TABLE IF NOT EXISTS "DeliveryRegistration" (
  id VARCHAR(50) PRIMARY KEY,
  "userId" VARCHAR(50) NOT NULL REFERENCES "User"(id),
  status VARCHAR(50) DEFAULT 'PENDING',
  "cpfCnh" VARCHAR(20) NOT NULL,
  "selfieWithDocUrl" TEXT,
  "motoWithPlateUrl" TEXT,
  "platePlateCloseupUrl" TEXT,
  "cnhPhotoUrl" TEXT,
  "crlvPhotoUrl" TEXT,
  "plateLicense" VARCHAR(20) NOT NULL,
  "currentKilometers" INTEGER,
  "lastOilChangeDate" TIMESTAMP,
  "lastOilChangeKm" INTEGER,
  "emergencyPhone" VARCHAR(20),
  "consentImages" BOOLEAN DEFAULT false,
  "approvedAt" TIMESTAMP,
  "approvedBy" VARCHAR(50),
  "rejectionReason" TEXT,
  "adminNotes" TEXT,
  "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_delivery_registration_user_id" ON "DeliveryRegistration"("userId");
CREATE INDEX IF NOT EXISTS "idx_delivery_registration_status" ON "DeliveryRegistration"(status);
