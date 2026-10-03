const IFOOD_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type IfoodAcceptMode = 'after_ifood_accept' | 'immediate';

/** after_ifood_accept espera o gerente no iFood. immediate confirma e chama o motoboy na hora. */
export function normalizeIfoodAcceptMode(value: unknown): IfoodAcceptMode {
  if (value == null || value === '') return 'after_ifood_accept';
  if (value === 'after_ifood_accept' || value === 'immediate') return value;
  throw new Error(
    'Modo de aceite iFood inválido. Use after_ifood_accept ou immediate.'
  );
}

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
