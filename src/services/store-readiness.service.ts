import { queryOne } from '../lib/db';

export interface ReadinessChecklistItem {
  key: string;
  label: string;
  done: boolean;
  hint?: string;
}

function hasOperatingHours(hours: unknown): boolean {
  if (!hours || typeof hours !== 'object') return false;
  return Object.values(hours as Record<string, unknown>).some((day) => {
    if (!day || typeof day !== 'object') return false;
    const d = day as { open?: string; close?: string; closed?: boolean };
    if (d.closed === true) return true;
    return Boolean(d.open && d.close);
  });
}

export class StoreReadinessService {
  async getReadinessChecklist(partnerId: string): Promise<ReadinessChecklistItem[]> {
    const partner = await queryOne<{
      slug: string | null;
      phone: string | null;
      operatingHours: unknown;
      storeCoverUrl: string | null;
      storeThemeColor: string | null;
      storeDescription: string | null;
      photoUrl: string | null;
    }>(
      `SELECT slug, phone, "operatingHours", "storeCoverUrl", "storeThemeColor",
              "storeDescription", "photoUrl"
       FROM "Partner" WHERE id = $1`,
      [partnerId]
    );
    if (!partner) throw new Error('Loja não encontrada');

    const counts = await queryOne<{ products: string; categories: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM "Product" WHERE "partnerId" = $1 AND active = true) AS products,
         (SELECT COUNT(*)::text FROM "ProductCategory" WHERE "partnerId" = $1 AND active = true) AS categories`,
      [partnerId]
    );

    const productCount = Number(counts?.products ?? 0);
    const categoryCount = Number(counts?.categories ?? 0);

    const slugDone = Boolean(partner.slug && String(partner.slug).trim());
    const productsDone = productCount > 0;
    const appearanceDone = Boolean(
      partner.storeThemeColor ||
        partner.storeCoverUrl ||
        partner.storeDescription ||
        partner.photoUrl
    );
    const hoursDone = hasOperatingHours(partner.operatingHours);
    const phoneDone = Boolean(partner.phone && String(partner.phone).trim());

    const testReady =
      slugDone && productsDone && phoneDone && hoursDone && appearanceDone && categoryCount > 0;

    return [
      {
        key: 'slug',
        label: 'URL pública (slug)',
        done: slugDone,
        hint: slugDone ? undefined : 'Defina o slug da loja para a vitrine pública',
      },
      {
        key: 'products',
        label: 'Produtos ativos',
        done: productsDone,
        hint: productsDone ? undefined : 'Cadastre ao menos um produto ativo',
      },
      {
        key: 'appearance',
        label: 'Aparência da vitrine',
        done: appearanceDone,
        hint: appearanceDone ? undefined : 'Configure logo, capa, cor ou descrição',
      },
      {
        key: 'hours',
        label: 'Horário de funcionamento',
        done: hoursDone,
        hint: hoursDone ? undefined : 'Informe os horários de atendimento',
      },
      {
        key: 'phone',
        label: 'Telefone de contato',
        done: phoneDone,
        hint: phoneDone ? undefined : 'Cadastre o telefone da loja',
      },
      {
        key: 'test-ready',
        label: 'Pronta para teste',
        done: testReady,
        hint: testReady
          ? undefined
          : 'Complete slug, produtos, categorias, aparência, horários e telefone',
      },
    ];
  }
}
