/**
 * Objeto gravado como `bankAccount` no POST Asaas `/transfers` ou no corpo de execute-transfer.
 * Validação leve para evitar `{}` ou tipos incorretos; o Asaas é a fonte de verdade dos campos.
 */
export function assertPayoutBankAccountShape(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Conta para repasse inválida: esperado objeto JSON');
  }
  const o = raw as Record<string, unknown>;
  const meaningful = Object.keys(o).filter(
    (k) => o[k] !== undefined && o[k] !== '' && o[k] !== null
  );
  if (meaningful.length < 3) {
    throw new Error(
      'Perfil de repasse incompleto demais para enviar ao Asaas (defina payout_bank_account no perfil ou envie bankAccount no POST)'
    );
  }
  return o;
}
