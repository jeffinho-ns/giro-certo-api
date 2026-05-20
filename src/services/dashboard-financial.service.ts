import { query, queryOne } from '../lib/db';
import { DeliverySettlementLedgerService } from './delivery-settlement-ledger.service';

export type FinancialTransactionType =
  | 'delivery_charge'
  | 'wallet_commission'
  | 'wallet_withdrawal'
  | 'wallet_bonus'
  | 'wallet_refund'
  | 'payout_transfer';

export interface FinancialTransactionRow {
  id: string;
  type: FinancialTransactionType;
  amount: number;
  status: string;
  description: string;
  counterparty: string | null;
  referenceId: string | null;
  occurredAt: string;
  meta?: {
    platformFee?: number;
    storeNet?: number;
    riderNet?: number;
    customerTotal?: number;
    storeName?: string | null;
    riderName?: string | null;
    beneficiaryType?: string;
  };
}

export interface DashboardFinancialReport {
  windowDays: number;
  summary: {
    totalCustomerVolume: number;
    platformRevenueDelivery: number;
    storeNetAccrued: number;
    riderNetAccrued: number;
    paidDeliveryCount: number;
    completedOrdersInWindow: number;
    walletCommissionRevenue: number;
    walletCommissionCount: number;
    walletWithdrawalsTotal: number;
    pendingStorePayout: number;
    pendingRiderPayout: number;
    payoutsExecutedTotal: number;
    payoutsExecutedCount: number;
    premiumSubscribers: number;
    activeSubscriptionPartners: number;
    subscriptionMrrEstimate: number;
  };
  revenueBreakdown: Array<{ name: string; value: number; key: string }>;
  monthlySeries: Array<{
    monthKey: string;
    monthLabel: string;
    customerVolume: number;
    platformRevenue: number;
    deliveryCount: number;
    walletCommissions: number;
  }>;
  transactions: FinancialTransactionRow[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseNum(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

const MONTH_LABELS = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
];

function monthLabelFromDate(d: Date): string {
  return `${MONTH_LABELS[d.getMonth()]}/${String(d.getFullYear()).slice(-2)}`;
}

export class DashboardFinancialService {
  async getReport(windowDays: number): Promise<DashboardFinancialReport> {
    const days = Number.isFinite(windowDays)
      ? Math.max(1, Math.min(Math.floor(windowDays), 365))
      : 30;

    const sinceInterval = `${days} days`;

    const [
      deliveryAgg,
      completedOrders,
      walletAgg,
      premiumSubscribers,
      subscriptionAgg,
      payoutsAgg,
      monthlyDelivery,
      monthlyWallet,
      recentPayments,
      recentWallet,
      recentPayouts,
      pendingSummary,
    ] = await Promise.all([
      queryOne<{
        cnt: string;
        customer_total: string;
        platform_fees: string;
        store_net: string;
        rider_net: string;
      }>(
        `SELECT
          COUNT(*)::text AS cnt,
          COALESCE(SUM("customerTotal"), 0)::text AS customer_total,
          COALESCE(SUM("platformFeeStore" + "platformFeeRider"), 0)::text AS platform_fees,
          COALESCE(SUM("storeNetSnapshot"), 0)::text AS store_net,
          COALESCE(SUM("riderNetSnapshot"), 0)::text AS rider_net
         FROM "DeliveryPayment"
         WHERE status = 'paid'
           AND "paidAt" IS NOT NULL
           AND "paidAt" >= NOW() - ($1::text)::interval`,
        [sinceInterval]
      ),
      queryOne<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt
         FROM "DeliveryOrder"
         WHERE status = 'completed'
           AND "completedAt" IS NOT NULL
           AND "completedAt" >= NOW() - ($1::text)::interval`,
        [sinceInterval]
      ),
      queryOne<{
        commission_sum: string;
        commission_cnt: string;
        withdrawal_sum: string;
      }>(
        `SELECT
          COALESCE(SUM(CASE WHEN type = 'COMMISSION' AND status = 'completed' THEN amount ELSE 0 END), 0)::text AS commission_sum,
          COALESCE(SUM(CASE WHEN type = 'COMMISSION' AND status = 'completed' THEN 1 ELSE 0 END), 0)::text AS commission_cnt,
          COALESCE(SUM(CASE WHEN type = 'WITHDRAWAL' AND status IN ('completed', 'pending') THEN ABS(amount) ELSE 0 END), 0)::text AS withdrawal_sum
         FROM "WalletTransaction"
         WHERE "createdAt" >= NOW() - ($1::text)::interval`,
        [sinceInterval]
      ),
      queryOne<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM "User"
         WHERE "isSubscriber" = true AND "subscriptionType" = 'premium'`
      ),
      queryOne<{ cnt: string; mrr: string }>(
        `SELECT
          COUNT(*)::text AS cnt,
          COALESCE(SUM("monthlyFee"), 0)::text AS mrr
         FROM "PartnerPayment"
         WHERE status = 'ACTIVE'
           AND "planType" = 'MONTHLY_SUBSCRIPTION'`
      ),
      queryOne<{ total: string; cnt: string }>(
        `SELECT
          COALESCE(SUM(net_payable), 0)::text AS total,
          COUNT(*)::text AS cnt
         FROM "DeliverySettlementBatch"
         WHERE status = 'transfer_done'
           AND "updatedAt" >= NOW() - ($1::text)::interval`,
        [sinceInterval]
      ),
      query<{
        month_key: string;
        customer_volume: string;
        platform_revenue: string;
        delivery_count: string;
      }>(
        `SELECT
          to_char(date_trunc('month', "paidAt"), 'YYYY-MM') AS month_key,
          COALESCE(SUM("customerTotal"), 0)::text AS customer_volume,
          COALESCE(SUM("platformFeeStore" + "platformFeeRider"), 0)::text AS platform_revenue,
          COUNT(*)::text AS delivery_count
         FROM "DeliveryPayment"
         WHERE status = 'paid'
           AND "paidAt" IS NOT NULL
           AND "paidAt" >= NOW() - ($1::text)::interval
         GROUP BY date_trunc('month', "paidAt")
         ORDER BY date_trunc('month', "paidAt")`,
        [sinceInterval]
      ),
      query<{ month_key: string; commission_sum: string }>(
        `SELECT
          to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month_key,
          COALESCE(SUM(amount), 0)::text AS commission_sum
         FROM "WalletTransaction"
         WHERE type = 'COMMISSION'
           AND status = 'completed'
           AND "createdAt" >= NOW() - ($1::text)::interval
         GROUP BY date_trunc('month', "createdAt")
         ORDER BY date_trunc('month', "createdAt")`,
        [sinceInterval]
      ),
      query<{
        id: string;
        deliveryOrderId: string;
        customerTotal: number;
        platformFeeStore: number;
        platformFeeRider: number;
        storeNetSnapshot: number;
        riderNetSnapshot: number;
        paidAt: Date;
        storeName: string | null;
        riderName: string | null;
        billingTypeRequested: string | null;
      }>(
        `SELECT
          dp.id,
          dp."deliveryOrderId",
          dp."customerTotal",
          dp."platformFeeStore",
          dp."platformFeeRider",
          dp."storeNetSnapshot",
          dp."riderNetSnapshot",
          dp."paidAt",
          o."storeName",
          u.name AS "riderName",
          dp."billingTypeRequested"
         FROM "DeliveryPayment" dp
         INNER JOIN "DeliveryOrder" o ON o.id = dp."deliveryOrderId"
         LEFT JOIN "User" u ON u.id = o."riderId"
         WHERE dp.status = 'paid'
           AND dp."paidAt" IS NOT NULL
           AND dp."paidAt" >= NOW() - ($1::text)::interval
         ORDER BY dp."paidAt" DESC
         LIMIT 80`,
        [sinceInterval]
      ),
      query<{
        id: string;
        type: string;
        amount: number;
        status: string;
        description: string | null;
        createdAt: Date;
        userName: string | null;
        deliveryOrderId: string | null;
      }>(
        `SELECT
          wt.id,
          wt.type,
          wt.amount,
          wt.status,
          wt.description,
          wt."createdAt",
          u.name AS "userName",
          wt."deliveryOrderId"
         FROM "WalletTransaction" wt
         LEFT JOIN "User" u ON u.id = wt."userId"
         WHERE wt."createdAt" >= NOW() - ($1::text)::interval
         ORDER BY wt."createdAt" DESC
         LIMIT 40`,
        [sinceInterval]
      ),
      query<{
        id: string;
        beneficiary_type: string;
        net_payable: number;
        status: string;
        updatedAt: Date;
        partner_name: string | null;
        rider_name: string | null;
      }>(
        `SELECT
          b.id,
          b.beneficiary_type,
          b.net_payable,
          b.status,
          b."updatedAt",
          p.name AS partner_name,
          u.name AS rider_name
         FROM "DeliverySettlementBatch" b
         LEFT JOIN "Partner" p ON p.id = b.partner_id
         LEFT JOIN "User" u ON u.id = b.rider_user_id
         WHERE b."updatedAt" >= NOW() - ($1::text)::interval
         ORDER BY b."updatedAt" DESC
         LIMIT 30`,
        [sinceInterval]
      ),
      new DeliverySettlementLedgerService().getPendingSummary(),
    ]);

    const totalCustomerVolume = parseNum(deliveryAgg?.customer_total);
    const platformRevenueDelivery = parseNum(deliveryAgg?.platform_fees);
    const walletCommissionRevenue = parseNum(walletAgg?.commission_sum);
    const subscriptionMrrEstimate = parseNum(subscriptionAgg?.mrr);

    const pendingStorePayout =
      pendingSummary.byStore.reduce((s, r) => s + r.pendingStoreNet, 0);
    const pendingRiderPayout =
      pendingSummary.byRider.reduce((s, r) => s + r.pendingRiderNet, 0) +
      pendingSummary.pendingRiderNetUnassigned;

    const walletByMonth = new Map(
      monthlyWallet.map((r) => [r.month_key, parseNum(r.commission_sum)])
    );

    const monthlySeries = monthlyDelivery.map((row) => {
      const [y, m] = row.month_key.split('-').map(Number);
      const d = new Date(y, (m || 1) - 1, 1);
      return {
        monthKey: row.month_key,
        monthLabel: monthLabelFromDate(d),
        customerVolume: round2(parseNum(row.customer_volume)),
        platformRevenue: round2(parseNum(row.platform_revenue)),
        deliveryCount: parseInt(row.delivery_count, 10) || 0,
        walletCommissions: round2(walletByMonth.get(row.month_key) ?? 0),
      };
    });

    const revenueBreakdown = [
      {
        key: 'delivery_platform',
        name: 'Taxas por corrida (entrega)',
        value: round2(platformRevenueDelivery),
      },
      {
        key: 'wallet_commission',
        name: 'Comissões carteira (motoboy)',
        value: round2(walletCommissionRevenue),
      },
      {
        key: 'subscription_mrr',
        name: 'Mensalidades lojas (MRR ativo)',
        value: round2(subscriptionMrrEstimate),
      },
    ].filter((r) => r.value > 0);

    if (revenueBreakdown.length === 0) {
      revenueBreakdown.push({
        key: 'none',
        name: 'Sem receita no período',
        value: 0,
      });
    }

    const transactions: FinancialTransactionRow[] = [];

    for (const p of recentPayments) {
      const platformFee = round2(
        (p.platformFeeStore ?? 0) + (p.platformFeeRider ?? 0)
      );
      const orderRef = p.deliveryOrderId.slice(-8);
      transactions.push({
        id: p.id,
        type: 'delivery_charge',
        amount: round2(p.customerTotal),
        status: 'paid',
        description: `Pedido #${orderRef} · ${p.billingTypeRequested ?? 'checkout'}`,
        counterparty: p.storeName,
        referenceId: p.deliveryOrderId,
        occurredAt: new Date(p.paidAt).toISOString(),
        meta: {
          platformFee,
          storeNet: round2(p.storeNetSnapshot),
          riderNet: round2(p.riderNetSnapshot),
          customerTotal: round2(p.customerTotal),
          storeName: p.storeName,
          riderName: p.riderName,
        },
      });
    }

    for (const w of recentWallet) {
      let type: FinancialTransactionType = 'wallet_commission';
      if (w.type === 'WITHDRAWAL') type = 'wallet_withdrawal';
      else if (w.type === 'BONUS') type = 'wallet_bonus';
      else if (w.type === 'REFUND') type = 'wallet_refund';

      transactions.push({
        id: w.id,
        type,
        amount: round2(Math.abs(w.amount)),
        status: w.status,
        description:
          w.description?.trim() ||
          (type === 'wallet_withdrawal' ? 'Saque carteira' : 'Comissão carteira'),
        counterparty: w.userName,
        referenceId: w.deliveryOrderId,
        occurredAt: new Date(w.createdAt).toISOString(),
      });
    }

    for (const b of recentPayouts) {
      const label =
        b.beneficiary_type === 'partner'
          ? `Repasse loja · ${b.partner_name ?? '—'}`
          : `Repasse entregador · ${b.rider_name ?? '—'}`;
      transactions.push({
        id: b.id,
        type: 'payout_transfer',
        amount: round2(b.net_payable),
        status: b.status,
        description: label,
        counterparty:
          b.beneficiary_type === 'partner' ? b.partner_name : b.rider_name,
        referenceId: b.id,
        occurredAt: new Date(b.updatedAt).toISOString(),
        meta: { beneficiaryType: b.beneficiary_type },
      });
    }

    transactions.sort(
      (a, b) =>
        new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
    );

    return {
      windowDays: days,
      summary: {
        totalCustomerVolume: round2(totalCustomerVolume),
        platformRevenueDelivery: round2(platformRevenueDelivery),
        storeNetAccrued: round2(parseNum(deliveryAgg?.store_net)),
        riderNetAccrued: round2(parseNum(deliveryAgg?.rider_net)),
        paidDeliveryCount: parseInt(deliveryAgg?.cnt || '0', 10) || 0,
        completedOrdersInWindow:
          parseInt(completedOrders?.cnt || '0', 10) || 0,
        walletCommissionRevenue: round2(walletCommissionRevenue),
        walletCommissionCount:
          parseInt(walletAgg?.commission_cnt || '0', 10) || 0,
        walletWithdrawalsTotal: round2(parseNum(walletAgg?.withdrawal_sum)),
        pendingStorePayout: round2(pendingStorePayout),
        pendingRiderPayout: round2(pendingRiderPayout),
        payoutsExecutedTotal: round2(parseNum(payoutsAgg?.total)),
        payoutsExecutedCount: parseInt(payoutsAgg?.cnt || '0', 10) || 0,
        premiumSubscribers: parseInt(premiumSubscribers?.cnt || '0', 10) || 0,
        activeSubscriptionPartners:
          parseInt(subscriptionAgg?.cnt || '0', 10) || 0,
        subscriptionMrrEstimate: round2(subscriptionMrrEstimate),
      },
      revenueBreakdown,
      monthlySeries,
      transactions: transactions.slice(0, 100),
    };
  }
}
