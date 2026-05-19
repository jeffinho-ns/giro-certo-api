/**
 * Perfil gravado em `payout_bank_account_json` (Partner / User).
 * Repasse Asaas: conta bancária (`bankAccount`) ou chave PIX (`pixAddressKey`).
 */

const PIX_KEY_TYPES = new Set(['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP']);

export type PayoutMethod = 'bank' | 'pix';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

/** Detecta método a partir do JSON guardado (retrocompatível). */
export function resolvePayoutMethod(raw: Record<string, unknown>): PayoutMethod {
  if (raw.payoutMethod === 'pix') return 'pix';
  if (isNonEmptyString(raw.pixAddressKey)) return 'pix';
  return 'bank';
}

/**
 * Valida o perfil antes de gravar na BD.
 * Aceita `payoutMethod`: `bank` | `pix` (default `bank` se omitido e houver dados de conta).
 */
export function assertPayoutProfileShape(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Perfil de repasse inválido: esperado objeto JSON');
  }
  const o = raw as Record<string, unknown>;
  const method = resolvePayoutMethod(o);

  if (method === 'pix') {
    const key = typeof o.pixAddressKey === 'string' ? o.pixAddressKey.trim() : '';
    const keyType =
      typeof o.pixAddressKeyType === 'string'
        ? o.pixAddressKeyType.trim().toUpperCase()
        : '';
    if (!key) {
      throw new Error('Chave PIX obrigatória para repasse por PIX');
    }
    if (!PIX_KEY_TYPES.has(keyType)) {
      throw new Error(
        'pixAddressKeyType inválido (use CPF, CNPJ, EMAIL, PHONE ou EVP)'
      );
    }
    const out: Record<string, unknown> = {
      payoutMethod: 'pix',
      pixAddressKey: key,
      pixAddressKeyType: keyType,
    };
    if (isNonEmptyString(o.ownerName)) {
      out.ownerName = o.ownerName.trim();
    }
    return out;
  }

  const ownerName = typeof o.ownerName === 'string' ? o.ownerName.trim() : '';
  const cpfCnpj =
    typeof o.cpfCnpj === 'string' ? o.cpfCnpj.replace(/\D/g, '') : '';
  const agency = typeof o.agency === 'string' ? o.agency.trim() : '';
  const account = typeof o.account === 'string' ? o.account.trim() : '';
  const accountDigit =
    typeof o.accountDigit === 'string' ? o.accountDigit.trim() : '';
  let bankCode = '';
  const bank = o.bank;
  if (bank && typeof bank === 'object' && !Array.isArray(bank)) {
    const code = (bank as Record<string, unknown>).code;
    if (typeof code === 'string' || typeof code === 'number') {
      bankCode = String(code).trim();
    }
  }

  if (!ownerName || !cpfCnpj || !agency || !account || !accountDigit || !bankCode) {
    throw new Error(
      'Conta bancária incompleta: preencha titular, CPF/CNPJ, banco, agência, conta e dígito'
    );
  }

  return {
    payoutMethod: 'bank',
    ownerName,
    cpfCnpj,
    agency,
    account,
    accountDigit,
    bank: { code: bankCode },
  };
}

/** @deprecated use assertPayoutProfileShape */
export function assertPayoutBankAccountShape(raw: unknown): Record<string, unknown> {
  return assertPayoutProfileShape(raw);
}

/** Monta corpo parcial para POST Asaas `/transfers`. */
export function buildAsaasTransferPayloadFromProfile(
  profile: Record<string, unknown>
): {
  bankAccount?: Record<string, unknown>;
  pixAddressKey?: string;
  pixAddressKeyType?: string;
  operationType?: 'PIX' | 'TED';
} {
  if (resolvePayoutMethod(profile) === 'pix') {
    return {
      pixAddressKey: String(profile.pixAddressKey).trim(),
      pixAddressKeyType: String(profile.pixAddressKeyType).trim().toUpperCase(),
      operationType: 'PIX',
    };
  }

  const { payoutMethod: _pm, ...bankFields } = profile;
  return {
    bankAccount: bankFields,
    operationType: 'PIX',
  };
}
