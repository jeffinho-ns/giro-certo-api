import { generateId } from '../utils/id';
import { execute, query, queryOne } from '../lib/db';
import { StoreOrder } from '../types';
import { computeCheckoutSplits } from './delivery-payment.service';
import { DeliverySettlementLedgerService } from './delivery-settlement-ledger.service';

type StoreOrderSettlementSource = Pick<
  StoreOrder,
  | 'id'
  | 'subtotal'
  | 'deliveryFee'
  | 'total'
  | 'asaasPaymentId'
  | 'asaasCustomerId'
  | 'billingType'
  | 'paidAt'
>;

/**
 * Ponte StoreOrder (pagamento na vitrine) → DeliveryPayment + DeliverySettlementLedger.
 * Pedidos da loja virtual não passam por initiateCheckout do DeliveryPayment; o repasse
 * só pode ser registrado após existir um DeliveryOrder (aceite do lojista).
 */
export class StoreOrderSettlementBridgeService {
  private readonly ledger = new DeliverySettlementLedgerService();

  /** Idempotente: cria cobrança sintética `paid` e linha pendente no livro. */
  async ensureRecorded(params: {
    storeOrder: StoreOrderSettlementSource;
    deliveryOrderId: string;
  }): Promise<void> {
    const ledgerExists = await queryOne<{ id: string }>(
      `SELECT id FROM "DeliverySettlementLedger" WHERE "deliveryOrderId" = $1`,
      [params.deliveryOrderId]
    );
    if (ledgerExists) return;

    const subtotal = Number(params.storeOrder.subtotal ?? 0);
    const deliveryFee = Number(params.storeOrder.deliveryFee ?? 0);
    const splits = computeCheckoutSplits({ value: subtotal, deliveryFee });
    const customerTotal =
      params.storeOrder.total && params.storeOrder.total > 0
        ? params.storeOrder.total
        : splits.customerTotal;

    const idempotencyKey = `store_order_${params.storeOrder.id}`;
    let paymentId: string | null = null;

    const existingPaid = await queryOne<{ id: string }>(
      `SELECT id FROM "DeliveryPayment"
       WHERE "deliveryOrderId" = $1 AND status = 'paid'
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      [params.deliveryOrderId]
    );
    if (existingPaid) {
      paymentId = existingPaid.id;
    } else {
      const existingByKey = await queryOne<{ id: string; status: string }>(
        `SELECT id, status FROM "DeliveryPayment" WHERE "idempotencyKey" = $1`,
        [idempotencyKey]
      );
      if (existingByKey) {
        paymentId = existingByKey.id;
        if (existingByKey.status !== 'paid') {
          await execute(
            `UPDATE "DeliveryPayment"
             SET status = 'paid',
                 "paidAt" = COALESCE("paidAt", $2),
                 "updatedAt" = NOW()
             WHERE id = $1`,
            [paymentId, params.storeOrder.paidAt ?? new Date()]
          );
        }
      } else {
        paymentId = generateId();
        await execute(
          `INSERT INTO "DeliveryPayment" (
            id, "deliveryOrderId", status, "collectionMode",
            "customerTotal", "itemValueSnapshot", "deliveryFeeSnapshot",
            "platformFeeStore", "platformFeeRider", "storeNetSnapshot", "riderNetSnapshot",
            currency, "idempotencyKey", "asaasPaymentId", "asaasCustomerId",
            "invoiceUrl", "billingTypeRequested", "paidAt", "lastWebhookEvent", "updatedAt"
          ) VALUES (
            $1, $2, 'paid', 'prepaid',
            $3, $4, $5,
            $6, $7, $8, $9,
            'BRL', $10, $11, $12,
            NULL, $13, $14, 'store_order_bridge', NOW()
          )`,
          [
            paymentId,
            params.deliveryOrderId,
            customerTotal,
            subtotal,
            deliveryFee,
            splits.platformFeeStore,
            splits.platformFeeRider,
            splits.storeNetSnapshot,
            splits.riderNetSnapshot,
            idempotencyKey,
            params.storeOrder.asaasPaymentId ?? null,
            params.storeOrder.asaasCustomerId ?? null,
            params.storeOrder.billingType ?? 'PIX',
            params.storeOrder.paidAt ?? new Date(),
          ]
        );
      }
    }

    if (!paymentId) return;

    await this.ledger.recordPaidDeliveryPayment({
      id: paymentId,
      deliveryOrderId: params.deliveryOrderId,
      storeNetSnapshot: splits.storeNetSnapshot,
      riderNetSnapshot: splits.riderNetSnapshot,
      platformFeeStore: splits.platformFeeStore,
      platformFeeRider: splits.platformFeeRider,
      customerTotal,
    });
  }

  /** Pedidos da vitrine já despachados sem linha no livro (histórico / correção). */
  async backfillMissing(limit = 200): Promise<{
    scanned: number;
    recorded: number;
    failures: Array<{ storeOrderId: string; error: string }>;
  }> {
    const lim = Math.min(Math.max(limit, 1), 500);
    const rows = await query<
      StoreOrderSettlementSource & { deliveryOrderId: string }
    >(
      `SELECT
        so.id,
        so.subtotal,
        so."deliveryFee",
        so.total,
        so."asaasPaymentId",
        so."asaasCustomerId",
        so."billingType",
        so."paidAt",
        so."deliveryOrderId"
       FROM "StoreOrder" so
       WHERE so."deliveryOrderId" IS NOT NULL
         AND so."paidAt" IS NOT NULL
         AND so.status IN ('dispatched', 'in_delivery', 'completed')
         AND NOT EXISTS (
           SELECT 1 FROM "DeliverySettlementLedger" l
           WHERE l."deliveryOrderId" = so."deliveryOrderId"
         )
       ORDER BY so."paidAt" ASC
       LIMIT $1`,
      [lim]
    );

    let recorded = 0;
    const failures: Array<{ storeOrderId: string; error: string }> = [];

    for (const row of rows) {
      try {
        await this.ensureRecorded({
          storeOrder: row,
          deliveryOrderId: row.deliveryOrderId,
        });
        recorded += 1;
      } catch (e: any) {
        failures.push({
          storeOrderId: row.id,
          error: e?.message || String(e),
        });
      }
    }

    return { scanned: rows.length, recorded, failures };
  }
}
