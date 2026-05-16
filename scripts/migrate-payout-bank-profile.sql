-- Fase 3 — perfil de repasse persistido (objeto compatível com Asaas `/transfers` → bankAccount)

ALTER TABLE "Partner"
  ADD COLUMN IF NOT EXISTS payout_bank_account_json JSONB NULL;

COMMENT ON COLUMN "Partner".payout_bank_account_json IS
  'JSON do beneficiário para repasse (formato esperado pela API Asaas em bankAccount; opcional PATCH /api/partners/me/payout-bank-profile).';

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS payout_bank_account_json JSONB NULL;

COMMENT ON COLUMN "User".payout_bank_account_json IS
  'JSON do rider para repasse (mesmo contrato que bankAccount Asaas; PATCH /api/users/me/payout-bank-profile).';
