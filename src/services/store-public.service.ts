import { randomBytes } from 'crypto';
import { query, queryOne, transaction } from '../lib/db';
import { generateId } from '../utils/id';
import {
  CreateStoreOrderDto,
  ProductOption,
  ProductOptionGroup,
  SelectedOptionSnapshot,
  StoreOrderStatus,
} from '../types';
import { DeliveryPricingService } from './delivery-pricing.service';
import { normalizeCpfCnpjDigits } from '../utils/cpf-cnpj';

const pricingService = new DeliveryPricingService();

/** Loja pública (DTO reduzido) — NUNCA expõe cnpj, conta bancária, comissões, etc. */
export interface PublicStoreDto {
  id: string;
  slug: string;
  name: string;
  tradingName: string | null;
  photoUrl: string | null;
  address: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  avgPreparationTime: number | null;
  operatingHours: any | null;
  rating: number;
  reviewCount: number;
  isOpen: boolean;
}

export interface PublicCatalogOptionDto {
  id: string;
  name: string;
  priceDelta: number;
}

export interface PublicCatalogOptionGroupDto {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  options: PublicCatalogOptionDto[];
}

export interface PublicCatalogProductDto {
  id: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  basePrice: number;
  photoUrl: string | null;
  optionGroups: PublicCatalogOptionGroupDto[];
}

export interface PublicCatalogCategoryDto {
  id: string;
  name: string;
  products: PublicCatalogProductDto[];
}

export interface PublicStorefrontDto {
  store: PublicStoreDto;
  banners: Array<{ id: string; imageUrl: string; title: string | null; linkUrl: string | null }>;
  categories: PublicCatalogCategoryDto[];
}

export class StorePublicService {
  // ============================================
  // Vitrine: loja + catálogo por slug (DTO reduzido)
  // ============================================
  async getStorefrontBySlug(slug: string): Promise<PublicStorefrontDto | null> {
    const partner = await queryOne<any>(
      `SELECT id, slug, name, "tradingName", "photoUrl", address, latitude, longitude,
              phone, "avgPreparationTime", "operatingHours", rating, "reviewCount", "isBlocked"
       FROM "Partner"
       WHERE slug = $1`,
      [slug]
    );
    if (!partner) return null;

    const store: PublicStoreDto = {
      id: partner.id,
      slug: partner.slug,
      name: partner.name,
      tradingName: partner.tradingName ?? null,
      photoUrl: partner.photoUrl ?? null,
      address: partner.address,
      latitude: partner.latitude,
      longitude: partner.longitude,
      phone: partner.phone ?? null,
      avgPreparationTime: partner.avgPreparationTime ?? null,
      operatingHours: partner.operatingHours ?? null,
      rating: partner.rating ?? 0,
      reviewCount: partner.reviewCount ?? 0,
      isOpen: !partner.isBlocked,
    };

    const banners = await query<{ id: string; imageUrl: string; title: string | null; linkUrl: string | null }>(
      `SELECT id, "imageUrl", title, "linkUrl"
       FROM "StoreBanner"
       WHERE "partnerId" = $1 AND active = true
         AND ("startsAt" IS NULL OR "startsAt" <= NOW())
         AND ("endsAt" IS NULL OR "endsAt" >= NOW())
       ORDER BY "sortOrder" ASC, "createdAt" ASC`,
      [partner.id]
    );

    const categories = await query<{ id: string; name: string }>(
      `SELECT id, name FROM "ProductCategory"
       WHERE "partnerId" = $1 AND active = true
       ORDER BY "sortOrder" ASC, "createdAt" ASC`,
      [partner.id]
    );

    const products = await query<any>(
      `SELECT id, "categoryId", name, description, "basePrice", "photoUrl"
       FROM "Product"
       WHERE "partnerId" = $1 AND active = true
       ORDER BY "sortOrder" ASC, "createdAt" ASC`,
      [partner.id]
    );

    const productIds = products.map((p) => p.id);
    let groups: ProductOptionGroup[] = [];
    let options: ProductOption[] = [];
    if (productIds.length > 0) {
      groups = await query<ProductOptionGroup>(
        `SELECT * FROM "ProductOptionGroup"
         WHERE "productId" = ANY($1::text[])
         ORDER BY "sortOrder" ASC, "createdAt" ASC`,
        [productIds]
      );
      const groupIds = groups.map((g) => g.id);
      if (groupIds.length > 0) {
        options = await query<ProductOption>(
          `SELECT * FROM "ProductOption"
           WHERE "optionGroupId" = ANY($1::text[]) AND active = true
           ORDER BY "sortOrder" ASC, "createdAt" ASC`,
          [groupIds]
        );
      }
    }

    const productDtos: PublicCatalogProductDto[] = products.map((p) => ({
      id: p.id,
      categoryId: p.categoryId ?? null,
      name: p.name,
      description: p.description ?? null,
      basePrice: p.basePrice,
      photoUrl: p.photoUrl ?? null,
      optionGroups: groups
        .filter((g) => g.productId === p.id)
        .map((g) => ({
          id: g.id,
          name: g.name,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          required: g.required,
          options: options
            .filter((o) => o.optionGroupId === g.id)
            .map((o) => ({ id: o.id, name: o.name, priceDelta: o.priceDelta })),
        })),
    }));

    // Produtos sem categoria entram numa seção virtual "Outros".
    const categoryDtos: PublicCatalogCategoryDto[] = categories.map((c) => ({
      id: c.id,
      name: c.name,
      products: productDtos.filter((p) => p.categoryId === c.id),
    }));
    const uncategorized = productDtos.filter(
      (p) => !p.categoryId || !categories.some((c) => c.id === p.categoryId)
    );
    if (uncategorized.length > 0) {
      categoryDtos.push({ id: 'uncategorized', name: 'Outros', products: uncategorized });
    }

    return { store, banners, categories: categoryDtos };
  }

  // ============================================
  // Criação de pedido (preços recalculados no servidor)
  // ============================================
  async createOrder(slug: string, dto: CreateStoreOrderDto) {
    const partner = await queryOne<any>(
      `SELECT id, latitude, longitude, "isBlocked" FROM "Partner" WHERE slug = $1`,
      [slug]
    );
    if (!partner) throw new Error('Loja não encontrada');
    if (partner.isBlocked) throw new Error('Loja indisponível no momento');

    const name = (dto.customerName ?? '').trim();
    const phone = (dto.customerPhone ?? '').trim();
    const address = (dto.customerAddress ?? '').trim();
    if (!name) throw new Error('Nome do cliente é obrigatório');
    if (!phone) throw new Error('Telefone do cliente é obrigatório');
    if (!address) throw new Error('Endereço do cliente é obrigatório');
    if (!Array.isArray(dto.items) || dto.items.length === 0) {
      throw new Error('O pedido precisa de pelo menos um item');
    }

    // Monta itens com preços do banco (NUNCA confiar em valor do cliente).
    const computedItems: Array<{
      productId: string;
      name: string;
      unitPrice: number;
      quantity: number;
      selectedOptions: SelectedOptionSnapshot[];
      lineTotal: number;
      notes: string | null;
    }> = [];

    for (const itemDto of dto.items) {
      const quantity = Number(itemDto.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error('Quantidade inválida em um dos itens');
      }

      const product = await queryOne<any>(
        `SELECT id, name, "basePrice" FROM "Product"
         WHERE id = $1 AND "partnerId" = $2 AND active = true`,
        [itemDto.productId, partner.id]
      );
      if (!product) {
        throw new Error('Produto indisponível no pedido');
      }

      const groups = await query<ProductOptionGroup>(
        `SELECT * FROM "ProductOptionGroup" WHERE "productId" = $1`,
        [product.id]
      );
      const groupIds = groups.map((g) => g.id);
      const validOptions = groupIds.length
        ? await query<ProductOption>(
            `SELECT * FROM "ProductOption"
             WHERE "optionGroupId" = ANY($1::text[]) AND active = true`,
            [groupIds]
          )
        : [];

      const selectedIds = Array.isArray(itemDto.selectedOptionIds)
        ? itemDto.selectedOptionIds
        : [];
      const selectedOptions: SelectedOptionSnapshot[] = [];
      let optionsTotal = 0;

      // Valida cada opção escolhida e calcula deltas a partir do banco.
      for (const optId of selectedIds) {
        const opt = validOptions.find((o) => o.id === optId);
        if (!opt) {
          throw new Error('Opção inválida selecionada em um dos itens');
        }
        const group = groups.find((g) => g.id === opt.optionGroupId)!;
        selectedOptions.push({
          groupName: group.name,
          optionName: opt.name,
          priceDelta: opt.priceDelta,
        });
        optionsTotal += opt.priceDelta;
      }

      // Aplica restrições de min/max por grupo (obrigatório, limites).
      for (const group of groups) {
        const countInGroup = selectedIds.filter((id) =>
          validOptions.some((o) => o.id === id && o.optionGroupId === group.id)
        ).length;
        const min = group.required ? Math.max(group.minSelect, 1) : group.minSelect;
        if (countInGroup < min) {
          throw new Error(`Selecione ao menos ${min} opção(ões) em "${group.name}"`);
        }
        if (countInGroup > group.maxSelect) {
          throw new Error(`Máximo de ${group.maxSelect} opção(ões) em "${group.name}"`);
        }
      }

      const unitPrice = Number(product.basePrice);
      const lineTotal = Number(((unitPrice + optionsTotal) * quantity).toFixed(2));
      computedItems.push({
        productId: product.id,
        name: product.name,
        unitPrice,
        quantity,
        selectedOptions,
        lineTotal,
        notes: itemDto.notes ? String(itemDto.notes) : null,
      });
    }

    const subtotal = Number(
      computedItems.reduce((acc, it) => acc + it.lineTotal, 0).toFixed(2)
    );

    // Taxa de entrega: cotada no servidor quando há coordenadas do cliente.
    let deliveryFee = 0;
    if (
      typeof dto.customerLatitude === 'number' &&
      typeof dto.customerLongitude === 'number' &&
      typeof partner.latitude === 'number' &&
      typeof partner.longitude === 'number'
    ) {
      try {
        const quote = await pricingService.calculateQuote({
          storeLatitude: partner.latitude,
          storeLongitude: partner.longitude,
          deliveryLatitude: dto.customerLatitude,
          deliveryLongitude: dto.customerLongitude,
        });
        deliveryFee = quote.deliveryFee;
      } catch {
        // Cotação indisponível: segue sem taxa (será resolvida no checkout/pagamento).
        deliveryFee = 0;
      }
    }

    const total = Number((subtotal + deliveryFee).toFixed(2));
    const trackingToken = randomBytes(24).toString('hex');

    const created = await transaction(async (client) => {
      const customerId = generateId();
      await client.query(
        `INSERT INTO "StoreCustomer" (id, name, phone, address)
         VALUES ($1, $2, $3, $4)`,
        [customerId, name, phone, address]
      );

      const orderId = generateId();
      await client.query(
        `INSERT INTO "StoreOrder" (
          id, "partnerId", "customerId",
          "customerName", "customerPhone", "customerAddress", "customerCpf",
          "customerLatitude", "customerLongitude", notes,
          subtotal, "deliveryFee", total, currency,
          status, "trackingToken"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          orderId,
          partner.id,
          customerId,
          name,
          phone,
          address,
          normalizeCpfCnpjDigits(dto.customerCpf),
          dto.customerLatitude ?? null,
          dto.customerLongitude ?? null,
          dto.notes ? String(dto.notes) : null,
          subtotal,
          deliveryFee,
          total,
          'BRL',
          StoreOrderStatus.awaiting_payment,
          trackingToken,
        ]
      );

      for (const it of computedItems) {
        await client.query(
          `INSERT INTO "StoreOrderItem" (
            id, "storeOrderId", "productId", name, "unitPrice", quantity,
            "selectedOptions", "lineTotal", notes
          ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
          [
            generateId(),
            orderId,
            it.productId,
            it.name,
            it.unitPrice,
            it.quantity,
            JSON.stringify(it.selectedOptions),
            it.lineTotal,
            it.notes,
          ]
        );
      }

      return { orderId };
    });

    return {
      id: created.orderId,
      trackingToken,
      status: StoreOrderStatus.awaiting_payment,
      subtotal,
      deliveryFee,
      total,
      currency: 'BRL',
      // O início do pagamento (Asaas) será conectado no Passo 4.
    };
  }

  // ============================================
  // Status do pedido por token (acompanhamento anônimo)
  // ============================================
  async getOrderStatusByToken(token: string) {
    const order = await queryOne<any>(
      `SELECT o.id, o.status, o.subtotal, o."deliveryFee", o.total, o.currency,
              o."createdAt", o."paidAt", o."acceptedAt", o."dispatchedAt",
              o."completedAt", o."cancelledAt", o."deliveryOrderId",
              p.name AS "storeName", p.slug AS "storeSlug"
       FROM "StoreOrder" o
       JOIN "Partner" p ON p.id = o."partnerId"
       WHERE o."trackingToken" = $1`,
      [token]
    );
    if (!order) return null;

    const items = await query<any>(
      `SELECT name, quantity, "unitPrice", "lineTotal", "selectedOptions"
       FROM "StoreOrderItem"
       WHERE "storeOrderId" = $1
       ORDER BY "createdAt" ASC`,
      [order.id]
    );

    return {
      id: order.id,
      status: order.status,
      store: { name: order.storeName, slug: order.storeSlug },
      items,
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      total: order.total,
      currency: order.currency,
      timeline: {
        createdAt: order.createdAt,
        paidAt: order.paidAt,
        acceptedAt: order.acceptedAt,
        dispatchedAt: order.dispatchedAt,
        completedAt: order.completedAt,
        cancelledAt: order.cancelledAt,
      },
      hasDelivery: !!order.deliveryOrderId,
    };
  }
}
