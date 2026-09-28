const IFOOD_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Store/chain ID do portal iFood. Vazio limpa o vínculo. */
export function normalizeIfoodMerchantId(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!IFOOD_UUID.test(trimmed)) {
    throw new Error('ID do iFood inválido. Use o Store/chain ID (UUID) da aba Permissions.');
  }
  return trimmed.toLowerCase();
}
