import { query, queryOne, execute, transaction } from '../lib/db';
import { generateId } from '../utils/id';
import {
  ProductCategory,
  Product,
  ProductOptionGroup,
  ProductOption,
  StoreBanner,
  CreateProductCategoryDto,
  UpdateProductCategoryDto,
  CreateProductDto,
  UpdateProductDto,
  CreateProductOptionGroupDto,
  CreateProductOptionDto,
  CreateStoreBannerDto,
  UpdateStoreBannerDto,
} from '../types';

/**
 * CRUD do catálogo da loja virtual (categorias, produtos, variações e banners).
 *
 * REGRA DE OURO: toda operação é escopada por partnerId. Em entidades aninhadas
 * (grupo de opção -> produto; opção -> grupo -> produto) a posse é validada por
 * JOIN até o Partner, para um lojista nunca tocar dados de outra loja.
 */
export class StoreCatalogService {
  // ============================================
  // Categorias
  // ============================================

  async listCategories(partnerId: string): Promise<ProductCategory[]> {
    return query<ProductCategory>(
      `SELECT * FROM "ProductCategory"
       WHERE "partnerId" = $1
       ORDER BY "sortOrder" ASC, "createdAt" ASC`,
      [partnerId]
    );
  }

  async createCategory(
    partnerId: string,
    dto: CreateProductCategoryDto
  ): Promise<ProductCategory> {
    const name = (dto.name ?? '').trim();
    if (!name) {
      throw new Error('Nome da categoria é obrigatório');
    }
    const id = generateId();
    const row = await queryOne<ProductCategory>(
      `INSERT INTO "ProductCategory" (id, "partnerId", name, "sortOrder", active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, partnerId, name, dto.sortOrder ?? 0, dto.active ?? true]
    );
    return row!;
  }

  async updateCategory(
    partnerId: string,
    id: string,
    dto: UpdateProductCategoryDto
  ): Promise<ProductCategory> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    if (dto.name !== undefined) {
      const name = (dto.name ?? '').trim();
      if (!name) throw new Error('Nome da categoria não pode ser vazio');
      sets.push(`name = $${idx++}`);
      vals.push(name);
    }
    if (dto.sortOrder !== undefined) {
      sets.push(`"sortOrder" = $${idx++}`);
      vals.push(dto.sortOrder);
    }
    if (dto.active !== undefined) {
      sets.push(`active = $${idx++}`);
      vals.push(dto.active);
    }
    if (sets.length === 0) {
      throw new Error('Nenhum campo para atualizar');
    }
    sets.push(`"updatedAt" = NOW()`);
    vals.push(id, partnerId);

    const row = await queryOne<ProductCategory>(
      `UPDATE "ProductCategory" SET ${sets.join(', ')}
       WHERE id = $${idx++} AND "partnerId" = $${idx}
       RETURNING *`,
      vals
    );
    if (!row) throw new Error('Categoria não encontrada');
    return row;
  }

  async deleteCategory(partnerId: string, id: string): Promise<void> {
    const affected = await execute(
      `DELETE FROM "ProductCategory" WHERE id = $1 AND "partnerId" = $2`,
      [id, partnerId]
    );
    if (affected === 0) throw new Error('Categoria não encontrada');
  }

  // ============================================
  // Produtos (com variações)
  // ============================================

  async listProducts(
    partnerId: string,
    filters: { categoryId?: string; active?: boolean } = {}
  ): Promise<Product[]> {
    const conditions = [`"partnerId" = $1`];
    const vals: unknown[] = [partnerId];
    let idx = 2;
    if (filters.categoryId !== undefined) {
      conditions.push(`"categoryId" = $${idx++}`);
      vals.push(filters.categoryId);
    }
    if (filters.active !== undefined) {
      conditions.push(`active = $${idx++}`);
      vals.push(filters.active);
    }
    return query<Product>(
      `SELECT * FROM "Product"
       WHERE ${conditions.join(' AND ')}
       ORDER BY "sortOrder" ASC, "createdAt" ASC`,
      vals
    );
  }

  /** Produto com grupos de opção e opções montados (para edição/detalhe). */
  async getProduct(partnerId: string, id: string): Promise<Product | null> {
    const product = await queryOne<Product>(
      `SELECT * FROM "Product" WHERE id = $1 AND "partnerId" = $2`,
      [id, partnerId]
    );
    if (!product) return null;

    const groups = await query<ProductOptionGroup>(
      `SELECT * FROM "ProductOptionGroup"
       WHERE "productId" = $1
       ORDER BY "sortOrder" ASC, "createdAt" ASC`,
      [id]
    );
    const groupIds = groups.map((g) => g.id);
    let options: ProductOption[] = [];
    if (groupIds.length > 0) {
      options = await query<ProductOption>(
        `SELECT * FROM "ProductOption"
         WHERE "optionGroupId" = ANY($1::text[])
         ORDER BY "sortOrder" ASC, "createdAt" ASC`,
        [groupIds]
      );
    }
    product.optionGroups = groups.map((g) => ({
      ...g,
      options: options.filter((o) => o.optionGroupId === g.id),
    }));
    return product;
  }

  async createProduct(partnerId: string, dto: CreateProductDto): Promise<Product> {
    const name = (dto.name ?? '').trim();
    if (!name) throw new Error('Nome do produto é obrigatório');
    if (typeof dto.basePrice !== 'number' || !Number.isFinite(dto.basePrice) || dto.basePrice < 0) {
      throw new Error('basePrice deve ser um número >= 0');
    }

    return transaction(async (client) => {
      // Se veio categoryId, garante que pertence a esta loja.
      if (dto.categoryId) {
        const cat = await client.query(
          `SELECT id FROM "ProductCategory" WHERE id = $1 AND "partnerId" = $2`,
          [dto.categoryId, partnerId]
        );
        if (cat.rowCount === 0) {
          throw new Error('Categoria informada não pertence a esta loja');
        }
      }

      const productId = generateId();
      const productRes = await client.query(
        `INSERT INTO "Product"
          (id, "partnerId", "categoryId", name, description, "basePrice", "photoUrl", active, "sortOrder")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          productId,
          partnerId,
          dto.categoryId ?? null,
          name,
          dto.description ?? null,
          dto.basePrice,
          dto.photoUrl ?? null,
          dto.active ?? true,
          dto.sortOrder ?? 0,
        ]
      );
      const product: Product = productRes.rows[0];

      if (dto.optionGroups && dto.optionGroups.length > 0) {
        product.optionGroups = [];
        for (const groupDto of dto.optionGroups) {
          const group = await this.insertOptionGroup(client, productId, groupDto);
          product.optionGroups.push(group);
        }
      }
      return product;
    });
  }

  async updateProduct(
    partnerId: string,
    id: string,
    dto: UpdateProductDto
  ): Promise<Product> {
    if (dto.categoryId) {
      const cat = await queryOne(
        `SELECT id FROM "ProductCategory" WHERE id = $1 AND "partnerId" = $2`,
        [dto.categoryId, partnerId]
      );
      if (!cat) throw new Error('Categoria informada não pertence a esta loja');
    }

    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    if (dto.categoryId !== undefined) {
      sets.push(`"categoryId" = $${idx++}`);
      vals.push(dto.categoryId);
    }
    if (dto.name !== undefined) {
      const name = (dto.name ?? '').trim();
      if (!name) throw new Error('Nome do produto não pode ser vazio');
      sets.push(`name = $${idx++}`);
      vals.push(name);
    }
    if (dto.description !== undefined) {
      sets.push(`description = $${idx++}`);
      vals.push(dto.description);
    }
    if (dto.basePrice !== undefined) {
      if (typeof dto.basePrice !== 'number' || !Number.isFinite(dto.basePrice) || dto.basePrice < 0) {
        throw new Error('basePrice deve ser um número >= 0');
      }
      sets.push(`"basePrice" = $${idx++}`);
      vals.push(dto.basePrice);
    }
    if (dto.photoUrl !== undefined) {
      sets.push(`"photoUrl" = $${idx++}`);
      vals.push(dto.photoUrl);
    }
    if (dto.active !== undefined) {
      sets.push(`active = $${idx++}`);
      vals.push(dto.active);
    }
    if (dto.sortOrder !== undefined) {
      sets.push(`"sortOrder" = $${idx++}`);
      vals.push(dto.sortOrder);
    }
    if (sets.length === 0) throw new Error('Nenhum campo para atualizar');

    sets.push(`"updatedAt" = NOW()`);
    vals.push(id, partnerId);

    const row = await queryOne<Product>(
      `UPDATE "Product" SET ${sets.join(', ')}
       WHERE id = $${idx++} AND "partnerId" = $${idx}
       RETURNING *`,
      vals
    );
    if (!row) throw new Error('Produto não encontrado');
    return row;
  }

  async deleteProduct(partnerId: string, id: string): Promise<void> {
    const affected = await execute(
      `DELETE FROM "Product" WHERE id = $1 AND "partnerId" = $2`,
      [id, partnerId]
    );
    if (affected === 0) throw new Error('Produto não encontrado');
  }

  // ============================================
  // Grupos de opção
  // ============================================

  private async insertOptionGroup(
    client: any,
    productId: string,
    dto: CreateProductOptionGroupDto
  ): Promise<ProductOptionGroup> {
    const name = (dto.name ?? '').trim();
    if (!name) throw new Error('Nome do grupo de opções é obrigatório');
    const minSelect = dto.minSelect ?? 0;
    const maxSelect = dto.maxSelect ?? 1;
    if (minSelect < 0 || maxSelect < minSelect) {
      throw new Error('minSelect deve ser >= 0 e maxSelect >= minSelect');
    }

    const groupId = generateId();
    const res = await client.query(
      `INSERT INTO "ProductOptionGroup"
        (id, "productId", name, "minSelect", "maxSelect", required, "sortOrder")
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [groupId, productId, name, minSelect, maxSelect, dto.required ?? false, dto.sortOrder ?? 0]
    );
    const group: ProductOptionGroup = res.rows[0];

    if (dto.options && dto.options.length > 0) {
      group.options = [];
      for (const optDto of dto.options) {
        const optName = (optDto.name ?? '').trim();
        if (!optName) throw new Error('Nome da opção é obrigatório');
        const optId = generateId();
        const optRes = await client.query(
          `INSERT INTO "ProductOption"
            (id, "optionGroupId", name, "priceDelta", active, "sortOrder")
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [optId, groupId, optName, optDto.priceDelta ?? 0, optDto.active ?? true, optDto.sortOrder ?? 0]
        );
        group.options.push(optRes.rows[0]);
      }
    }
    return group;
  }

  /** Verifica que o produto pertence à loja antes de criar o grupo. */
  async createOptionGroup(
    partnerId: string,
    productId: string,
    dto: CreateProductOptionGroupDto
  ): Promise<ProductOptionGroup> {
    return transaction(async (client) => {
      const prod = await client.query(
        `SELECT id FROM "Product" WHERE id = $1 AND "partnerId" = $2`,
        [productId, partnerId]
      );
      if (prod.rowCount === 0) {
        throw new Error('Produto não encontrado nesta loja');
      }
      return this.insertOptionGroup(client, productId, dto);
    });
  }

  async updateOptionGroup(
    partnerId: string,
    id: string,
    dto: Partial<CreateProductOptionGroupDto>
  ): Promise<ProductOptionGroup> {
    await this.assertOptionGroupOwnership(partnerId, id);

    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    if (dto.name !== undefined) {
      const name = (dto.name ?? '').trim();
      if (!name) throw new Error('Nome do grupo não pode ser vazio');
      sets.push(`name = $${idx++}`);
      vals.push(name);
    }
    if (dto.minSelect !== undefined) {
      sets.push(`"minSelect" = $${idx++}`);
      vals.push(dto.minSelect);
    }
    if (dto.maxSelect !== undefined) {
      sets.push(`"maxSelect" = $${idx++}`);
      vals.push(dto.maxSelect);
    }
    if (dto.required !== undefined) {
      sets.push(`required = $${idx++}`);
      vals.push(dto.required);
    }
    if (dto.sortOrder !== undefined) {
      sets.push(`"sortOrder" = $${idx++}`);
      vals.push(dto.sortOrder);
    }
    if (sets.length === 0) throw new Error('Nenhum campo para atualizar');
    sets.push(`"updatedAt" = NOW()`);
    vals.push(id);

    const row = await queryOne<ProductOptionGroup>(
      `UPDATE "ProductOptionGroup" SET ${sets.join(', ')}
       WHERE id = $${idx}
       RETURNING *`,
      vals
    );
    if (!row) throw new Error('Grupo de opções não encontrado');
    if (row.minSelect < 0 || row.maxSelect < row.minSelect) {
      throw new Error('minSelect deve ser >= 0 e maxSelect >= minSelect');
    }
    return row;
  }

  async deleteOptionGroup(partnerId: string, id: string): Promise<void> {
    await this.assertOptionGroupOwnership(partnerId, id);
    await execute(`DELETE FROM "ProductOptionGroup" WHERE id = $1`, [id]);
  }

  private async assertOptionGroupOwnership(partnerId: string, groupId: string): Promise<void> {
    const row = await queryOne(
      `SELECT g.id
       FROM "ProductOptionGroup" g
       JOIN "Product" p ON p.id = g."productId"
       WHERE g.id = $1 AND p."partnerId" = $2`,
      [groupId, partnerId]
    );
    if (!row) throw new Error('Grupo de opções não encontrado nesta loja');
  }

  // ============================================
  // Opções
  // ============================================

  async createOption(
    partnerId: string,
    groupId: string,
    dto: CreateProductOptionDto
  ): Promise<ProductOption> {
    await this.assertOptionGroupOwnership(partnerId, groupId);
    const name = (dto.name ?? '').trim();
    if (!name) throw new Error('Nome da opção é obrigatório');
    const id = generateId();
    const row = await queryOne<ProductOption>(
      `INSERT INTO "ProductOption"
        (id, "optionGroupId", name, "priceDelta", active, "sortOrder")
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, groupId, name, dto.priceDelta ?? 0, dto.active ?? true, dto.sortOrder ?? 0]
    );
    return row!;
  }

  async updateOption(
    partnerId: string,
    id: string,
    dto: Partial<CreateProductOptionDto>
  ): Promise<ProductOption> {
    await this.assertOptionOwnership(partnerId, id);

    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    if (dto.name !== undefined) {
      const name = (dto.name ?? '').trim();
      if (!name) throw new Error('Nome da opção não pode ser vazio');
      sets.push(`name = $${idx++}`);
      vals.push(name);
    }
    if (dto.priceDelta !== undefined) {
      sets.push(`"priceDelta" = $${idx++}`);
      vals.push(dto.priceDelta);
    }
    if (dto.active !== undefined) {
      sets.push(`active = $${idx++}`);
      vals.push(dto.active);
    }
    if (dto.sortOrder !== undefined) {
      sets.push(`"sortOrder" = $${idx++}`);
      vals.push(dto.sortOrder);
    }
    if (sets.length === 0) throw new Error('Nenhum campo para atualizar');
    sets.push(`"updatedAt" = NOW()`);
    vals.push(id);

    const row = await queryOne<ProductOption>(
      `UPDATE "ProductOption" SET ${sets.join(', ')}
       WHERE id = $${idx}
       RETURNING *`,
      vals
    );
    if (!row) throw new Error('Opção não encontrada');
    return row;
  }

  async deleteOption(partnerId: string, id: string): Promise<void> {
    await this.assertOptionOwnership(partnerId, id);
    await execute(`DELETE FROM "ProductOption" WHERE id = $1`, [id]);
  }

  private async assertOptionOwnership(partnerId: string, optionId: string): Promise<void> {
    const row = await queryOne(
      `SELECT o.id
       FROM "ProductOption" o
       JOIN "ProductOptionGroup" g ON g.id = o."optionGroupId"
       JOIN "Product" p ON p.id = g."productId"
       WHERE o.id = $1 AND p."partnerId" = $2`,
      [optionId, partnerId]
    );
    if (!row) throw new Error('Opção não encontrada nesta loja');
  }

  // ============================================
  // Banners
  // ============================================

  async listBanners(partnerId: string): Promise<StoreBanner[]> {
    return query<StoreBanner>(
      `SELECT * FROM "StoreBanner"
       WHERE "partnerId" = $1
       ORDER BY "sortOrder" ASC, "createdAt" ASC`,
      [partnerId]
    );
  }

  async createBanner(partnerId: string, dto: CreateStoreBannerDto): Promise<StoreBanner> {
    const imageUrl = (dto.imageUrl ?? '').trim();
    if (!imageUrl) throw new Error('imageUrl é obrigatório');
    const id = generateId();
    const row = await queryOne<StoreBanner>(
      `INSERT INTO "StoreBanner"
        (id, "partnerId", "imageUrl", title, "linkUrl", discount, "startsAt", "endsAt", active, "sortOrder")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        id,
        partnerId,
        imageUrl,
        dto.title ?? null,
        dto.linkUrl ?? null,
        dto.discount ?? null,
        dto.startsAt ?? null,
        dto.endsAt ?? null,
        dto.active ?? true,
        dto.sortOrder ?? 0,
      ]
    );
    return row!;
  }

  async updateBanner(
    partnerId: string,
    id: string,
    dto: UpdateStoreBannerDto
  ): Promise<StoreBanner> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    const map: Array<[keyof UpdateStoreBannerDto, string]> = [
      ['imageUrl', '"imageUrl"'],
      ['title', 'title'],
      ['linkUrl', '"linkUrl"'],
      ['discount', 'discount'],
      ['startsAt', '"startsAt"'],
      ['endsAt', '"endsAt"'],
      ['active', 'active'],
      ['sortOrder', '"sortOrder"'],
    ];
    for (const [key, column] of map) {
      if (dto[key] !== undefined) {
        sets.push(`${column} = $${idx++}`);
        vals.push(dto[key]);
      }
    }
    if (sets.length === 0) throw new Error('Nenhum campo para atualizar');
    sets.push(`"updatedAt" = NOW()`);
    vals.push(id, partnerId);

    const row = await queryOne<StoreBanner>(
      `UPDATE "StoreBanner" SET ${sets.join(', ')}
       WHERE id = $${idx++} AND "partnerId" = $${idx}
       RETURNING *`,
      vals
    );
    if (!row) throw new Error('Banner não encontrado');
    return row;
  }

  async deleteBanner(partnerId: string, id: string): Promise<void> {
    const affected = await execute(
      `DELETE FROM "StoreBanner" WHERE id = $1 AND "partnerId" = $2`,
      [id, partnerId]
    );
    if (affected === 0) throw new Error('Banner não encontrado');
  }

  // ============================================
  // Personalização da vitrine (capa, cor, descrição, logo)
  // ============================================

  async getAppearance(partnerId: string) {
    const row = await queryOne<any>(
      `SELECT id, name, "tradingName", "photoUrl", "storeCoverUrl",
              "storeThemeColor", "storeDescription", slug
       FROM "Partner" WHERE id = $1`,
      [partnerId]
    );
    if (!row) throw new Error('Loja não encontrada');
    return {
      id: row.id,
      name: row.name,
      slug: row.slug ?? null,
      tradingName: row.tradingName ?? null,
      photoUrl: row.photoUrl ?? null,
      coverUrl: row.storeCoverUrl ?? null,
      themeColor: row.storeThemeColor ?? null,
      description: row.storeDescription ?? null,
    };
  }

  async updateAppearance(
    partnerId: string,
    dto: {
      coverUrl?: string | null;
      themeColor?: string | null;
      description?: string | null;
      photoUrl?: string | null;
      tradingName?: string | null;
    }
  ) {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    const map: Array<[string, string]> = [
      ['coverUrl', '"storeCoverUrl"'],
      ['themeColor', '"storeThemeColor"'],
      ['description', '"storeDescription"'],
      ['photoUrl', '"photoUrl"'],
      ['tradingName', '"tradingName"'],
    ];

    // Valida cor hex quando informada (ex.: #FF6B00).
    if (
      dto.themeColor !== undefined &&
      dto.themeColor !== null &&
      String(dto.themeColor).trim() !== '' &&
      !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(dto.themeColor).trim())
    ) {
      throw new Error('Cor de destaque inválida (use formato hex, ex.: #FF6B00)');
    }

    for (const [key, col] of map) {
      if ((dto as any)[key] !== undefined) {
        const raw = (dto as any)[key];
        const value = raw === null || raw === '' ? null : String(raw).trim();
        sets.push(`${col} = $${idx++}`);
        vals.push(value);
      }
    }

    if (sets.length === 0) {
      return this.getAppearance(partnerId);
    }

    sets.push(`"updatedAt" = NOW()`);
    vals.push(partnerId);
    await execute(
      `UPDATE "Partner" SET ${sets.join(', ')} WHERE id = $${idx}`,
      vals
    );
    return this.getAppearance(partnerId);
  }
}
