/** Normaliza CPF (11) ou CNPJ (14) para somente dígitos; inválido → null. */
export function normalizeCpfCnpjDigits(raw: string | null | undefined): string | null {
  if (raw == null || String(raw).trim() === '') return null;
  const d = String(raw).replace(/\D/g, '');
  if (d.length === 11 || d.length === 14) return d;
  return null;
}

/** CPF/CNPJ do pagador: pedido → override na cobrança → env de testes. */
export function resolvePayerCpfCnpj(
  orderCpf: string | null | undefined,
  override?: string | null
): string {
  const fromOrder = normalizeCpfCnpjDigits(orderCpf);
  const fromOverride = normalizeCpfCnpjDigits(override);
  const fallback = normalizeCpfCnpjDigits(process.env.ASAAS_FALLBACK_PAYER_CPF);
  const cpf = fromOrder ?? fromOverride ?? fallback;
  if (!cpf) {
    throw new Error(
      'Informe o CPF do cliente no pedido para gerar a cobrança (cadastro ou ao gerar o link).'
    );
  }
  return cpf;
}
