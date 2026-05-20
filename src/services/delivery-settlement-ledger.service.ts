import { generateId } from '../utils/id';
import { execute, query, queryOne } from '../lib/db';

/** Subconjunto necessário para gravar uma linha de livro — evita ciclo com delivery-payment.service. */
export interface SettlementPaymentSnapshot {
  id: string;
  deliveryOrderId: string;
  storeNetSnapshot: number;
  riderNetSnapshot: number;
  platformFeeStore: number;
  platformFeeRider: number;
  customerTotal: number;
}

export interface PendingSettlementSummary {
  byStore: Array<{
    storeId: string;
    storeName: string | null;
    pendingCount: number;
    pendingStoreNet: number;
  }>;
  byRider: Array<{
    riderUserId: string;
    riderName: string | null;
    pendingCount: number;
    pendingRiderNet: number;
  }>;
  /** Valor de frete líquido ainda sem motoqueiro associado ao registro do livro */
  pendingRiderNetUnassigned: number;
}

export class DeliverySettlementLedgerService {
  /**
   * Idempotente: uma linha por `deliveryPaymentId` (confirmado webhook `paid`).
   */
  async recordPaidDeliveryPayment(
    payment: SettlementPaymentSnapshot
  ): Promise<void> {
    const exists = await queryOne<{ id: string }>(
      `SELECT id FROM "DeliverySettlementLedger" WHERE "deliveryPaymentId" = $1`,
      [payment.id]
    );
    if (exists) {
      return;
    }

    const order = await queryOne<{
      id: string;
      storeId: string;
      riderId: string | null;
    }>(
      `SELECT id, "storeId", "riderId" FROM "DeliveryOrder" WHERE id = $1`,
      [payment.deliveryOrderId]
    );
    if (!order) {
      console.warn('[DeliverySettlementLedger] Pedido não encontrado', {
        deliveryPaymentId: payment.id,
        deliveryOrderId: payment.deliveryOrderId,
      });
      return;
    }

    await execute(
      `INSERT INTO "DeliverySettlementLedger" (
        id, "deliveryPaymentId", "deliveryOrderId", "storeId", "riderUserId",
        "storeNetAmount", "riderNetAmount", "platformFeeStore", "platformFeeRider",
        "customerTotal", currency, settlement_status, "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, 'BRL', 'pending', NOW(), NOW()
      )`,
      [
        generateId(),
        payment.id,
        order.id,
        order.storeId,
        order.riderId ?? null,
        payment.storeNetSnapshot,
        payment.riderNetSnapshot,
        payment.platformFeeStore,
        payment.platformFeeRider,
        payment.customerTotal,
      ]
    );
  }

  /** Quando um rider aceita após pré-pago, preenchemos beneficiário da fatia frete (se estava NULL). */
  async assignRiderToLedgerForOrder(
    deliveryOrderId: string,
    riderUserId: string
  ): Promise<void> {
    await execute(
      `UPDATE "DeliverySettlementLedger"
       SET "riderUserId" = $2, "updatedAt" = NOW()
       WHERE "deliveryOrderId" = $1
         AND "riderUserId" IS NULL
         AND settlement_status = 'pending'`,
      [deliveryOrderId, riderUserId]
    );
  }

  async getPendingSummary(): Promise<PendingSettlementSummary> {
    const storeRows = await query<{
      storeId: string;
      storeName: string | null;
      pendingCount: string;
      pendingStoreNet: string;
    }>(
      `SELECT 
        l."storeId",
        p.name AS "storeName",
        COUNT(*)::text AS "pendingCount",
        SUM(l."storeNetAmount")::text AS "pendingStoreNet"
       FROM "DeliverySettlementLedger" l
       INNER JOIN "Partner" p ON p.id = l."storeId"
       WHERE l.settlement_status = 'pending'
         AND l.partner_settlement_batch_id IS NULL
       GROUP BY l."storeId", p.name
       ORDER BY SUM(l."storeNetAmount") DESC`
    );

    const riderRows = await query<{
      riderUserId: string;
      riderName: string | null;
      pendingCount: string;
      pendingRiderNet: string;
    }>(
      `SELECT 
        l."riderUserId" AS "riderUserId",
        u.name AS "riderName",
        COUNT(*)::text AS "pendingCount",
        SUM(l."riderNetAmount")::text AS "pendingRiderNet"
       FROM "DeliverySettlementLedger" l
       LEFT JOIN "User" u ON u.id = l."riderUserId"
       WHERE l.settlement_status = 'pending'
         AND l.rider_settlement_batch_id IS NULL
         AND l."riderUserId" IS NOT NULL
         AND l."riderNetAmount" >= 0.01
       GROUP BY l."riderUserId", u.name
       ORDER BY SUM(l."riderNetAmount") DESC`
    );

    const unassigned = await queryOne<{ s: string }>(
      `SELECT COALESCE(SUM("riderNetAmount"), 0)::text AS s
       FROM "DeliverySettlementLedger"
       WHERE settlement_status = 'pending'
         AND "riderUserId" IS NULL
         AND rider_settlement_batch_id IS NULL`
    );

    return {
      byStore: storeRows.map((r) => ({
        storeId: r.storeId,
        storeName: r.storeName,
        pendingCount: parseInt(r.pendingCount, 10) || 0,
        pendingStoreNet: parseFloat(r.pendingStoreNet) || 0,
      })),
      byRider: riderRows.map((r) => ({
        riderUserId: r.riderUserId,
        riderName: r.riderName,
        pendingCount: parseInt(r.pendingCount, 10) || 0,
        pendingRiderNet: parseFloat(r.pendingRiderNet) || 0,
      })),
      pendingRiderNetUnassigned: parseFloat(unassigned?.s ?? '0') || 0,
    };
  }
}
