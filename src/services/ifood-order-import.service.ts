import type { Application } from 'express';
import { query, queryOne } from '../lib/db';
import type { DeliveryOrder, Partner } from '../types';
import { DeliveryService } from './delivery.service';
import {
  acknowledgeIfoodEvents,
  confirmIfoodOrder,
  fetchIfoodOrder,
  pollIfoodEvents,
} from './ifood-client';

export type IfoodImportResult = {
  ifoodOrderId: string;
  created: boolean;
  dispatched: boolean;
  deliveryOrderId: string | null;
  reason: string;
};

type IfoodAddress = {
  formattedAddress?: string;
  streetName?: string;
  streetNumber?: string;
  neighborhood?: string;
  city?: string;
  coordinates?: { latitude?: number; longitude?: number };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function formatAddress(address: IfoodAddress): string {
  if (address.formattedAddress?.trim()) return address.formattedAddress.trim();
  return [address.streetName, address.streetNumber, address.neighborhood, address.city]
    .filter((part) => typeof part === 'string' && part.trim())
    .join(', ');
}

function isPlacedEvent(event: { code?: string; fullCode?: string }): boolean {
  const code = (event.fullCode || event.code || '').toUpperCase();
  return code === 'PLACED' || code === 'PLC';
}

export class IfoodOrderImportService {
  constructor(private readonly deliveryService = new DeliveryService()) {}

  async importOrder(
    ifoodOrderId: string,
    app?: Application
  ): Promise<IfoodImportResult> {
    const existing = await queryOne<DeliveryOrder>(
      'SELECT * FROM "DeliveryOrder" WHERE "ifoodOrderId" = $1',
      [ifoodOrderId]
    );
    if (existing) {
      return {
        ifoodOrderId,
        created: false,
        dispatched: existing.status !== 'awaiting_dispatch',
        deliveryOrderId: existing.id,
        reason: 'already_imported',
      };
    }

    const raw = await fetchIfoodOrder(ifoodOrderId);
    const delivery = asRecord(raw.delivery);
    const deliveredBy = String(delivery?.deliveredBy || '');
    if (deliveredBy !== 'MERCHANT') {
      return {
        ifoodOrderId,
        created: false,
        dispatched: false,
        deliveryOrderId: null,
        reason: 'not_merchant_delivery',
      };
    }

    const merchant = asRecord(raw.merchant);
    const merchantId = String(merchant?.id || '').toLowerCase();
    const partner = await queryOne<Partner>(
      'SELECT * FROM "Partner" WHERE "ifoodMerchantId" = $1',
      [merchantId]
    );
    if (!partner) {
      return {
        ifoodOrderId,
        created: false,
        dispatched: false,
        deliveryOrderId: null,
        reason: 'merchant_not_linked',
      };
    }
    if (partner.isBlocked) {
      return {
        ifoodOrderId,
        created: false,
        dispatched: false,
        deliveryOrderId: null,
        reason: 'partner_blocked',
      };
    }

    const address = (asRecord(delivery?.deliveryAddress) || {}) as IfoodAddress;
    const latitude = Number(address.coordinates?.latitude);
    const longitude = Number(address.coordinates?.longitude);
    const deliveryAddress = formatAddress(address);
    if (!deliveryAddress || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error('Pedido iFood sem endereço ou coordenadas de entrega.');
    }

    const customer = asRecord(raw.customer);
    const phone = asRecord(customer?.phone);
    const total = asRecord(raw.total);
    const subTotal = Number(total?.subTotal);
    const orderAmount = Number(total?.orderAmount);
    const value = Number.isFinite(subTotal) ? subTotal : Number.isFinite(orderAmount) ? orderAmount : 0;
    const isTest = raw.isTest === true;
    const displayId = String(raw.displayId || ifoodOrderId);
    const observations = typeof delivery?.observations === 'string' ? delivery.observations : '';
    const notes = [
      `Pedido iFood #${displayId}.`,
      isTest ? 'TESTE iFood — não entregar.' : '',
      observations,
    ]
      .filter(Boolean)
      .join(' ');

    const created = await this.deliveryService.createOrder({
      storeId: partner.id,
      storeName: partner.tradingName || partner.name,
      storeAddress: partner.address,
      storeLatitude: partner.latitude,
      storeLongitude: partner.longitude,
      deliveryAddress,
      deliveryLatitude: latitude,
      deliveryLongitude: longitude,
      recipientName: typeof customer?.name === 'string' ? customer.name : undefined,
      recipientPhone: typeof phone?.number === 'string' ? phone.number : undefined,
      notes,
      value,
      deliveryFee: 0,
    });
    if (!created) {
      throw new Error('Falha ao criar a corrida a partir do pedido iFood.');
    }

    await query('UPDATE "DeliveryOrder" SET "ifoodOrderId" = $1 WHERE id = $2', [
      ifoodOrderId,
      created.id,
    ]);

    try {
      await confirmIfoodOrder(ifoodOrderId);
    } catch (error) {
      console.warn(
        '[ifood] confirm',
        ifoodOrderId,
        error instanceof Error ? error.message : error
      );
    }

    if (isTest) {
      return {
        ifoodOrderId,
        created: true,
        dispatched: false,
        deliveryOrderId: created.id,
        reason: 'test_order_not_dispatched',
      };
    }

    const dispatched = await this.deliveryService.dispatchOrder(created.id);
    await this.deliveryService.announceOrderToRiders(dispatched, app);
    return {
      ifoodOrderId,
      created: true,
      dispatched: true,
      deliveryOrderId: dispatched.id,
      reason: 'dispatched',
    };
  }

  async pollLinkedMerchants(app?: Application): Promise<IfoodImportResult[]> {
    const partners = await query<{ ifoodMerchantId: string }>(
      'SELECT "ifoodMerchantId" FROM "Partner" WHERE "ifoodMerchantId" IS NOT NULL'
    );
    const merchantIds = partners.map((row) => row.ifoodMerchantId);
    if (merchantIds.length === 0) return [];

    const events = await pollIfoodEvents(merchantIds);
    const results: IfoodImportResult[] = [];
    const ackIds: string[] = [];
    for (const event of events) {
      if (!event.id) continue;
      ackIds.push(event.id);
      if (!isPlacedEvent(event) || !event.orderId) continue;
      try {
        results.push(await this.importOrder(event.orderId, app));
      } catch (error) {
        console.warn(
          '[ifood] import',
          event.orderId,
          error instanceof Error ? error.message : error
        );
      }
    }
    if (ackIds.length > 0) {
      await acknowledgeIfoodEvents(ackIds);
    }
    return results;
  }
}
