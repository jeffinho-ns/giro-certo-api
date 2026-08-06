import { StoreCatalogService } from './store-catalog.service';

export interface StoreTemplate {
  id: string;
  name: string;
  description: string;
  appearance: {
    themeColor: string;
    description: string;
    coverUrl?: string | null;
  };
  sampleCategory?: {
    name: string;
    sortOrder?: number;
  };
}

const TEMPLATES: StoreTemplate[] = [
  {
    id: 'classic-orange',
    name: 'Clássico Laranja',
    description: 'Visual vibrante com destaque laranja Giro Certo',
    appearance: {
      themeColor: '#FF6B00',
      description: 'Peças e acessórios com entrega rápida na sua região.',
    },
    sampleCategory: { name: 'Destaques', sortOrder: 0 },
  },
  {
    id: 'midnight-blue',
    name: 'Azul Noturno',
    description: 'Tema escuro e profissional',
    appearance: {
      themeColor: '#1E3A5F',
      description: 'Qualidade e confiança para o seu dia a dia.',
    },
    sampleCategory: { name: 'Mais vendidos', sortOrder: 0 },
  },
  {
    id: 'fresh-green',
    name: 'Verde Fresco',
    description: 'Visual leve e moderno',
    appearance: {
      themeColor: '#2E7D32',
      description: 'Novidades e promoções toda semana.',
    },
  },
];

export class StoreTemplatesService {
  private readonly catalog = new StoreCatalogService();

  listTemplates(): Array<Omit<StoreTemplate, 'sampleCategory'>> {
    return TEMPLATES.map(({ id, name, description, appearance }) => ({
      id,
      name,
      description,
      appearance,
    }));
  }

  async applyTemplate(
    partnerId: string,
    templateId: string
  ): Promise<{ template: StoreTemplate; appearance: unknown; category?: unknown }> {
    const template = TEMPLATES.find((t) => t.id === templateId);
    if (!template) throw new Error('Template não encontrado');

    const appearance = await this.catalog.updateAppearance(partnerId, {
      themeColor: template.appearance.themeColor,
      description: template.appearance.description,
      coverUrl: template.appearance.coverUrl ?? null,
    });

    let category: unknown;
    if (template.sampleCategory) {
      const existing = await this.catalog.listCategories(partnerId);
      const alreadyHas = existing.some(
        (c) => c.name.toLowerCase() === template.sampleCategory!.name.toLowerCase()
      );
      if (!alreadyHas) {
        category = await this.catalog.createCategory(partnerId, {
          name: template.sampleCategory.name,
          sortOrder: template.sampleCategory.sortOrder ?? 0,
          active: true,
        });
      }
    }

    return { template, appearance, category };
  }
}
