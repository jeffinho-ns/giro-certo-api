import { query, queryOne, execute } from '../lib/db';
import { DeliveryService } from './delivery.service';
import { DeliveryOrder, StoreOrder, StoreOrderStatus } from '../types';
import { asaasRefundPayment, isAsaasConfigured } from './asaas.service';
import { ssePublishStoreOrder } from '../utils/socket-events';
import { ssePublish } from '../utils/sse-hub';

/**
 * Gestão dos pedidos da loja virtual pelo LOJISTA (escopado por partnerId).
 * O aceite é a PONTE: converte o StoreOrder pago em DeliveryOrder e despacha,
 * reaproveitando o pipeline de entrega já existente.
 */
export class StoreOrderService {
  private readonly deliveryService = new DeliveryService();

  /** Campos seguros do pedido para o lojista (sem payload de webhook cru). */
  private readonly listColumns = `
    id, "partnerId", "customerName", "customerPhone", "customerAddress",
    "customerLatitude", "customerLongitude", notes,
    subtotal, "deliveryFee", discount, "couponCode", total, currency, status,
    "trackingToken", "deliveryOrderId", "invoiceUrl",
    "createdAt", "paidAt", "acceptedAt", "dispatchedAt", "completedAt", "cancelledAt"
  `;

  async listOrders(
    partnerId: string,
    filters: { status?: StoreOrderStatus; limit?: number } = {}
  ): Promise<StoreOrder[]> {
    const conditions = [`"partnerId" = $1`];
    const vals: unknown[] = [partnerId];
    let idx = 2;
    if (filters.status) {
      conditions.push(`status = $${idx++}`);
      vals.push(filters.status);
    }
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    vals.push(limit);
    return query<StoreOrder>(
      `SELECT ${this.listColumns} FROM "StoreOrder"
       WHERE ${conditions.join(' AND ')}
       ORDER BY "createdAt" DESC
       LIMIT $${idx}`,
      vals
    );
  }

  async getOrder(partnerId: string, id: string): Promise<StoreOrder | null> {
    const order = await queryOne<StoreOrder>(
      `SELECT ${this.listColumns} FROM "StoreOrder" WHERE id = $1 AND "partnerId" = $2`,
      [id, partnerId]
    );
    if (!order) return null;
    const items = await query<any>(
      `SELECT name, quantity, "unitPrice", "lineTotal", "selectedOptions", notes
       FROM "StoreOrderItem" WHERE "storeOrderId" = $1 ORDER BY "createdAt" ASC`,
      [id]
    );
    (order as any).items = items;
    return order;
  }

  /**
   * Aceite do lojista: gera o DeliveryOrder a partir do StoreOrder pago e despacha.
   * Retorna o DeliveryOrder despachado (para o controller anunciar aos motoboys).
   */
  async acceptOrder(
    partnerId: string,
    id: string
  ): Promise<{ storeOrder: StoreOrder; deliveryOrder: DeliveryOrder }> {
    const order = await queryOne<StoreOrder>(
      `SELECT * FROM "StoreOrder" WHERE id = $1 AND "partnerId" = $2`,
      [id, partnerId]
    );
    if (!order) throw new Error('Pedido não encontrado');

    if (order.deliveryOrderId) {
      throw new Error('Pedido já foi despachado');
    }
    // Segurança: só despacha após pagamento confirmado pelo webhook.
    if (order.status !== StoreOrderStatus.paid) {
      throw new Error('O pedido só pode ser aceito após o pagamento confirmado');
    }
    if (
      typeof order.customerLatitude !== 'number' ||
      typeof order.customerLongitude !== 'number'
    ) {
      throw new Error(
        'Pedido sem coordenadas de entrega; não é possível despachar a corrida'
      );
    }

    const partner = await queryOne<any>(
      `SELECT id, name, address, latitude, longitude, "isBlocked" FROM "Partner" WHERE id = $1`,
      [partnerId]
    );
    if (!partner) throw new Error('Loja não encontrada');
    if (partner.isBlocked) throw new Error('Loja bloqueada; não é possível despachar');

    // 1) Cria o pedido de entrega reusando o motor atual (status awaiting_dispatch).
    const created = await this.deliveryService.createOrder({
      storeId: partner.id,
      storeName: partner.name,
      storeAddress: partner.address,
      storeLatitude: partner.latitude,
      storeLongitude: partner.longitude,
      deliveryAddress: order.customerAddress,
      deliveryLatitude: order.customerLatitude,
      deliveryLongitude: order.customerLongitude,
      recipientName: order.customerName,
      recipientPhone: order.customerPhone,
      recipientCpf: order.customerCpf ?? undefined,
      notes: `Loja virtual • pedido #${order.id.slice(-8)}`,
      value: order.subtotal,
      deliveryFee: order.deliveryFee,
      priority: undefined,
    });
    if (!created) throw new Error('Falha ao criar a entrega');
    const deliveryOrderId = (created as any).id as string;

    // 2) Despacha (awaiting_dispatch -> pending) para ofertar aos motoboys.
    const dispatched = await this.deliveryService.dispatchOrder(deliveryOrderId);

    // 3) Liga os dois lados e marca o StoreOrder como despachado.
    await execute(
      `UPDATE "DeliveryOrder" SET "storeOrderId" = $1 WHERE id = $2`,
      [order.id, deliveryOrderId]
    );
    await execute(
      `UPDATE "StoreOrder"
       SET status = $2,
           "deliveryOrderId" = $3,
           "acceptedAt" = COALESCE("acceptedAt", NOW()),
           "dispatchedAt" = NOW(),
           "updatedAt" = NOW()
       WHERE id = $1`,
      [order.id, StoreOrderStatus.dispatched, deliveryOrderId]
    );

    const storeOrder = await queryOne<StoreOrder>(
      `SELECT ${this.listColumns} FROM "StoreOrder" WHERE id = $1`,
      [order.id]
    );

    if (storeOrder?.trackingToken) {
      ssePublishStoreOrder(storeOrder.trackingToken, 'store_order:update', {
        orderId: storeOrder.id,
        status: storeOrder.status,
        deliveryOrderId,
      });
    }

    return { storeOrder: storeOrder!, deliveryOrder: dispatched };
  }

  async rejectOrder(
    partnerId: string,
    id: string,
    reason?: string
  ): Promise<{ order: StoreOrder; message: string }> {
    const order = await queryOne<StoreOrder>(
      `SELECT id, status, "asaasPaymentId", total FROM "StoreOrder" WHERE id = $1 AND "partnerId" = $2`,
      [id, partnerId]
    );
    if (!order) throw new Error('Pedido não encontrado');
    if (
      order.status !== StoreOrderStatus.paid &&
      order.status !== StoreOrderStatus.awaiting_payment
    ) {
      throw new Error('Pedido não pode ser recusado neste status');
    }

    const wasPaid = order.status === StoreOrderStatus.paid;
    const note = reason ? String(reason).slice(0, 500) : null;

    let refundNote: string | null = null;
    if (wasPaid && order.asaasPaymentId && isAsaasConfigured()) {
      try {
        await asaasRefundPayment(String(order.asaasPaymentId), {
          value: order.total ?? undefined,
          description: `Estorno pedido loja #${order.id.slice(-8)}`,
        });
        refundNote = 'Estorno PIX solicitado automaticamente no Asaas.';
      } catch (err: any) {
        refundNote = `Estorno automático falhou: ${err?.message ?? 'erro desconhecido'}. Faça o estorno manualmente no painel Asaas.`;
      }
    } else if (wasPaid) {
      refundNote =
        'Pagamento já recebido — estorne manualmente no painel Asaas (ASAAS_API_KEY ausente ou cobrança sem ID).';
    }

    const updated = await queryOne<StoreOrder>(
      `UPDATE "StoreOrder"
       SET status = $2,
           notes = CASE
             WHEN $3 IS NOT NULL AND $4 IS NOT NULL THEN CONCAT(COALESCE(notes, ''), E'\\n', $3, ' — ', $4)
             WHEN $3 IS NOT NULL THEN COALESCE($3, notes)
             WHEN $4 IS NOT NULL THEN CONCAT(COALESCE(notes, ''), E'\\n', $4)
             ELSE notes
           END,
           "cancelledAt" = NOW(),
           "updatedAt" = NOW()
       WHERE id = $1
       RETURNING ${this.listColumns}`,
      [id, StoreOrderStatus.rejected, note, refundNote]
    );

    const message = wasPaid
      ? refundNote?.includes('solicitado automaticamente')
        ? 'Pedido recusado. O estorno PIX foi solicitado no Asaas (confirme no painel em alguns minutos).'
        : refundNote ?? 'Pedido recusado. Verifique o estorno no painel Asaas.'
      : 'Pedido recusado.';

    if (updated?.trackingToken) {
      ssePublishStoreOrder(updated.trackingToken, 'store_order:update', {
        orderId: updated.id,
        status: updated.status,
      });
    }
    ssePublish(`store:${partnerId}`, 'delivery:store_refresh', {
      storeId: partnerId,
      reason: 'store_order_rejected',
      orderId: id,
    });

    return { order: updated!, message };
  }
}
