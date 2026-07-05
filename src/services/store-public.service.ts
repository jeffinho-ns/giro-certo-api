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
import { StoreCouponService } from './store-coupon.service';
import { normalizeCpfCnpjDigits } from '../utils/cpf-cnpj';
import { computePartnerIsOpen } from '../utils/partner-is-open';
import { GooglePlacesService } from './google-places.service';

const pricingService = new DeliveryPricingService();
const couponService = new StoreCouponService();
const googlePlacesService = new GooglePlacesService();

/** Loja pública (DTO reduzido) — NUNCA expõe cnpj, conta bancária, comissões, etc. */
export interface PublicStoreDto {
  id: string;
  slug: string;
  name: string;
  tradingName: string | null;
  photoUrl: string | null;
  coverUrl: string | null;
  themeColor: string | null;
  description: string | null;
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

export interface PublicReviewDto {
  rating: number;
  comment: string | null;
  customerName: string | null;
  createdAt: Date;
}

export interface PublicStorefrontDto {
  store: PublicStoreDto;
  banners: Array<{ id: string; imageUrl: string; title: string | null; linkUrl: string | null }>;
  categories: PublicCatalogCategoryDto[];
  reviews: PublicReviewDto[];
}

export class StorePublicService {
  // ============================================
  // Vitrine: loja + catálogo por slug (DTO reduzido)
  // ============================================
  async getStorefrontBySlug(slug: string): Promise<PublicStorefrontDto | null> {
    const partner = await queryOne<any>(
      `SELECT id, slug, name, "tradingName", "photoUrl", "storeCoverUrl", "storeThemeColor",
              "storeDescription", address, latitude, longitude,
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
      coverUrl: partner.storeCoverUrl ?? null,
      themeColor: partner.storeThemeColor ?? null,
      description: partner.storeDescription ?? null,
      address: partner.address,
      latitude: partner.latitude,
      longitude: partner.longitude,
      phone: partner.phone ?? null,
      avgPreparationTime: partner.avgPreparationTime ?? null,
      operatingHours: partner.operatingHours ?? null,
      rating: partner.rating ?? 0,
      reviewCount: partner.reviewCount ?? 0,
      isOpen: computePartnerIsOpen(!!partner.isBlocked, partner.operatingHours),
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

    // Avaliações recentes (vitrine pública).
    const reviews = await query<any>(
      `SELECT rating, comment, "customerName", "createdAt"
       FROM "StoreReview"
       WHERE "partnerId" = $1 AND comment IS NOT NULL AND comment <> ''
       ORDER BY "createdAt" DESC
       LIMIT 5`,
      [partner.id]
    );

    return {
      store,
      banners,
      categories: categoryDtos,
      reviews: reviews.map((r) => ({
        rating: r.rating,
        comment: r.comment,
        customerName: r.customerName ?? null,
        createdAt: r.createdAt,
      })),
    };
  }

  /**
   * Registra a avaliação de um pedido (1 por pedido) e recalcula a média da loja.
   * Identidade via trackingToken (cliente anônimo).
   */
  async submitReview(token: string, rating: number, comment?: string) {
    const r = Math.round(Number(rating));
    if (!Number.isFinite(r) || r < 1 || r > 5) {
      throw new Error('Nota deve ser entre 1 e 5');
    }

    const order = await queryOne<any>(
      `SELECT id, "partnerId", status, "customerName" FROM "StoreOrder" WHERE "trackingToken" = $1`,
      [token]
    );
    if (!order) throw new Error('Pedido não encontrado');
    if (order.status === StoreOrderStatus.cancelled || order.status === StoreOrderStatus.rejected) {
      throw new Error('Pedido cancelado não pode ser avaliado');
    }
    if (order.status === StoreOrderStatus.awaiting_payment) {
      throw new Error('Avalie após o pagamento ser confirmado');
    }

    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM "StoreReview" WHERE "storeOrderId" = $1`,
      [order.id]
    );
    if (existing) throw new Error('Este pedido já foi avaliado');

    const id = generateId();
    const cleanComment = comment ? String(comment).trim().slice(0, 1000) : null;
    await query(
      `INSERT INTO "StoreReview" (id, "partnerId", "storeOrderId", rating, comment, "customerName")
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, order.partnerId, order.id, r, cleanComment, order.customerName ?? null]
    );

    // Recalcula a média e o total da loja a partir das avaliações.
    const agg = await queryOne<{ avg: string; count: string }>(
      `SELECT COALESCE(AVG(rating), 0) AS avg, COUNT(*) AS count
       FROM "StoreReview" WHERE "partnerId" = $1`,
      [order.partnerId]
    );
    const avg = Number(Number(agg?.avg ?? 0).toFixed(2));
    const count = Number(agg?.count ?? 0);
    await query(
      `UPDATE "Partner" SET rating = $1, "reviewCount" = $2, "updatedAt" = NOW() WHERE id = $3`,
      [avg, count, order.partnerId]
    );

    return { ok: true, rating: r, storeRating: avg, reviewCount: count };
  }

  // ============================================
  // Criação de pedido (preços recalculados no servidor)
  // ============================================
  async createOrder(slug: string, dto: CreateStoreOrderDto) {
    const partner = await queryOne<any>(
      `SELECT id, latitude, longitude, "isBlocked", "operatingHours" FROM "Partner" WHERE slug = $1`,
      [slug]
    );
    if (!partner) throw new Error('Loja não encontrada');
    if (!computePartnerIsOpen(!!partner.isBlocked, partner.operatingHours)) {
      throw new Error(
        partner.isBlocked
          ? 'Loja indisponível no momento'
          : 'Loja fechada no momento; não é possível fazer pedidos'
      );
    }

    const name = (dto.customerName ?? '').trim();
    const phone = (dto.customerPhone ?? '').trim();
    let address = (dto.customerAddress ?? '').trim();
    if (!name) throw new Error('Nome do cliente é obrigatório');
    if (!phone) throw new Error('Telefone do cliente é obrigatório');
    if (!address) throw new Error('Endereço do cliente é obrigatório');

    let customerLatitude =
      typeof dto.customerLatitude === 'number' && Number.isFinite(dto.customerLatitude)
        ? dto.customerLatitude
        : null;
    let customerLongitude =
      typeof dto.customerLongitude === 'number' && Number.isFinite(dto.customerLongitude)
        ? dto.customerLongitude
        : null;

    // Sem GPS do cliente: geocodifica o endereço no servidor (taxa de entrega + despacho).
    if (customerLatitude == null || customerLongitude == null) {
      const geocoded = await this.geocodeCustomerAddress(address);
      customerLatitude = geocoded.latitude;
      customerLongitude = geocoded.longitude;
      address = geocoded.formattedAddress || address;
    }
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

    // Cupom: validado e precificado no servidor (nunca confiar no cliente).
    let discount = 0;
    let couponId: string | null = null;
    let couponCode: string | null = null;
    if (dto.couponCode && String(dto.couponCode).trim()) {
      const result = await couponService.validateAndCompute(
        partner.id,
        String(dto.couponCode),
        subtotal
      );
      discount = result.discount;
      couponId = result.coupon.id;
      couponCode = result.coupon.code;
    }

    // Taxa de entrega: cotada no servidor quando há coordenadas do cliente.
    let deliveryFee = 0;
    if (
      customerLatitude != null &&
      customerLongitude != null &&
      typeof partner.latitude === 'number' &&
      typeof partner.longitude === 'number'
    ) {
      try {
        const quote = await pricingService.calculateQuote({
          storeLatitude: partner.latitude,
          storeLongitude: partner.longitude,
          deliveryLatitude: customerLatitude,
          deliveryLongitude: customerLongitude,
        });
        deliveryFee = quote.deliveryFee;
      } catch {
        // Cotação indisponível: segue sem taxa (será resolvida no checkout/pagamento).
        deliveryFee = 0;
      }
    }

    const total = Number(Math.max(0, subtotal - discount + deliveryFee).toFixed(2));
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
          subtotal, "deliveryFee", discount, "couponCode", "couponId", total, currency,
          status, "trackingToken"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          orderId,
          partner.id,
          customerId,
          name,
          phone,
          address,
          normalizeCpfCnpjDigits(dto.customerCpf),
          customerLatitude,
          customerLongitude,
          dto.notes ? String(dto.notes) : null,
          subtotal,
          deliveryFee,
          discount,
          couponCode,
          couponId,
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
      discount,
      couponCode,
      deliveryFee,
      total,
      currency: 'BRL',
    };
  }

  /**
   * Pré-validação de cupom para a vitrine (mostra o desconto antes de finalizar).
   * Retorna o desconto calculado sobre o subtotal informado.
   */
  async previewCoupon(slug: string, code: string, subtotal: number) {
    const partner = await queryOne<any>(
      `SELECT id FROM "Partner" WHERE slug = $1`,
      [slug]
    );
    if (!partner) throw new Error('Loja não encontrada');
    const { coupon, discount } = await couponService.validateAndCompute(
      partner.id,
      code,
      Number(subtotal) || 0
    );
    return {
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      discount,
    };
  }

  // ============================================
  // Status do pedido por token (acompanhamento anônimo)
  // ============================================
  async getOrderStatusByToken(token: string) {
    const order = await queryOne<any>(
      `SELECT o.id, o.status, o.subtotal, o.discount, o."couponCode", o."deliveryFee", o.total, o.currency,
              o."createdAt", o."paidAt", o."acceptedAt", o."dispatchedAt",
              o."completedAt", o."cancelledAt", o."deliveryOrderId",
              o."customerLatitude", o."customerLongitude",
              p.name AS "storeName", p.slug AS "storeSlug",
              p.latitude AS "storeLatitude", p.longitude AS "storeLongitude"
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

    const review = await queryOne<{ id: string }>(
      `SELECT id FROM "StoreReview" WHERE "storeOrderId" = $1`,
      [order.id]
    );

    // Tracking: coords da loja/cliente + posição do rider só em entrega ativa.
    let tracking: {
      active: boolean;
      storeLat: number | null;
      storeLng: number | null;
      deliveryLat: number | null;
      deliveryLng: number | null;
      riderLat: number | null;
      riderLng: number | null;
    } | null = null;

    if (order.deliveryOrderId) {
      const delivery = await queryOne<any>(
        `SELECT d.status, d."deliveryLatitude", d."deliveryLongitude",
                d."storeLatitude", d."storeLongitude",
                u."currentLat" AS "riderLat", u."currentLng" AS "riderLng"
         FROM "DeliveryOrder" d
         LEFT JOIN "User" u ON u.id = d."riderId"
         WHERE d.id = $1`,
        [order.deliveryOrderId]
      );
      const active =
        !!delivery &&
        delivery.status !== 'completed' &&
        delivery.status !== 'cancelled';
      tracking = {
        active,
        storeLat: delivery?.storeLatitude ?? order.storeLatitude ?? null,
        storeLng: delivery?.storeLongitude ?? order.storeLongitude ?? null,
        deliveryLat:
          delivery?.deliveryLatitude ?? order.customerLatitude ?? null,
        deliveryLng:
          delivery?.deliveryLongitude ?? order.customerLongitude ?? null,
        // Privacidade: posição do rider só durante entrega ativa.
        riderLat: active ? delivery?.riderLat ?? null : null,
        riderLng: active ? delivery?.riderLng ?? null : null,
      };
    }

    return {
      id: order.id,
      status: order.status,
      store: { name: order.storeName, slug: order.storeSlug },
      items,
      subtotal: order.subtotal,
      discount: order.discount ?? 0,
      couponCode: order.couponCode ?? null,
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
      tracking,
      reviewed: !!review,
    };
  }

  /** Autocomplete de endereço para checkout público (sem auth). */
  async autocompleteAddress(input: string, sessionToken?: string) {
    return googlePlacesService.autocomplete(input, sessionToken);
  }

  /** Detalhes do endereço selecionado (coordenadas para taxa de entrega). */
  async placeDetails(placeId: string, sessionToken?: string) {
    return googlePlacesService.placeDetails(placeId, sessionToken);
  }

  private async geocodeCustomerAddress(address: string) {
    const suggestions = await googlePlacesService.autocomplete(address);
    if (suggestions.length === 0) {
      throw new Error(
        'Não foi possível localizar o endereço. Use "minha localização" ou informe rua, número, bairro e cidade.'
      );
    }
    const details = await googlePlacesService.placeDetails(suggestions[0].placeId);
    return {
      latitude: details.latitude,
      longitude: details.longitude,
      formattedAddress: details.formattedAddress || address,
    };
  }
}
