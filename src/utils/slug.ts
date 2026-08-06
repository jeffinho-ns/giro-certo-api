/**
 * Gera um slug a partir do nome da loja: minúsculas, sem acentos,
 * palavras separadas por "-". Ex.: "Hambúrgueria do Zé" -> "hamburgueria-do-ze".
 */
export function slugify(input: string): string {
  return (input ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // não-alfanumérico vira hífen
    .replace(/^-+|-+$/g, '') // remove hífens das pontas
    .replace(/-{2,}/g, '-'); // colapsa hífens repetidos
}

/**
 * Garante unicidade do slug consultando colisões via `exists`.
 * Acrescenta sufixos -2, -3, ... até achar um livre.
 * `exists(candidate)` deve retornar true se o slug já estiver em uso.
 */
export async function uniqueSlug(
  base: string,
  exists: (candidate: string) => Promise<boolean>,
  fallback = 'loja'
): Promise<string> {
  const root = slugify(base) || fallback;
  let candidate = root;
  let n = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await exists(candidate)) {
    n += 1;
    candidate = `${root}-${n}`;
  }
  return candidate;
}
