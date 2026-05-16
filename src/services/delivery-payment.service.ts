import { generateId } from '../utils/id';
import { queryOne, execute } from '../lib/db';
import { DeliveryOrder, DeliveryStatus, UserRole } from '../types';
import { DeliveryService } from './delivery.service';
import {
  asaasCreateCustomer,
  asaasCreatePayment,
  asaasGetPayment,
  isAsaasConfigured,
  AsaasBillingType,
} from './asaas.service';

export type DeliveryPaymentCollectionMode =
  | 'prepaid'
  | 'postpaid_pix'
  | 'authorize_capture';

export interface DeliveryPaymentRow {
  id: string;
  deliveryOrderId: string;
  status: string;
  collectionMode: DeliveryPaymentCollectionMode;
  customerTotal: number;
  itemValueSnapshot: number;
  deliveryFeeSnapshot: number;
  platformFeeStore: number;
  platformFeeRider: number;
  storeNetSnapshot: number;
  riderNetSnapshot: number;
  currency: string;
  idempotencyKey: string;
  asaasPaymentId: string | null;
  asaasCustomerId: string | null;
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
  billingTypeRequested: string | null;
  lastWebhookEvent: string | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Data de vencimento da cobrança (America/Sao_Paulo). */
export function brazilDueDateToday(): string {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Sao_Paulo',
  });
}

export function computeCheckoutSplits(order: Pick<DeliveryOrder, 'value' | 'deliveryFee'>): {
  customerTotal: number;
  platformFeeStore: number;
  platformFeeRider: number;
  storeNetSnapshot: number;
  riderNetSnapshot: number;
} {
  const platformFeeStore = roundMoney(
    Number(process.env.GIRO_PLATFORM_FEE_STORE_FIXED ?? 2)
  );
  const platformFeeRider = roundMoney(
    Number(process.env.GIRO_PLATFORM_FEE_RIDER_PER_ORDER ?? 1)
  );
  const customerTotal = roundMoney(order.value + order.deliveryFee);
  const storeNetSnapshot = roundMoney(Math.max(0, order.value - platformFeeStore));
  const riderNetSnapshot = roundMoney(
    Math.max(0, order.deliveryFee - platformFeeRider)
  );
  return {
    customerTotal,
    platformFeeStore,
    platformFeeRider,
    storeNetSnapshot,
    riderNetSnapshot,
  };
}

function normalizePhoneDigits(raw: string | null | undefined): string {
  const d = (raw ?? '').replace(/\D/g, '');
  return d;
}

function payerEmailFromPhone(digits: string, orderId: string): string {
  const safe = digits.length >= 8 ? digits.slice(-11) : digits.padStart(11, '0');
  return `payer.${safe}.${orderId.slice(-8)}@checkout.girocerto.local`;
}

export type PaidAssertContext = 'dispatch' | 'accept_rider';

export class DeliveryPaymentService {
  private readonly deliveryService = new DeliveryService();

  assertPartnerStoreAccess(user: {
    partnerId?: string | null;
    role?: UserRole | string;
  }, storeId: string): void {
    if (user.role === UserRole.ADMIN) return;
    const pid = user.partnerId != null ? String(user.partnerId) : '';
    if (!pid || pid !== storeId) {
      throw new Error('Sem permissão para cobrar este pedido');
    }
  }

  /**
   * Se a loja estiver em modo pré-pago, exige um `DeliveryPayment` com status `paid`
   * antes de despacho ou antes do motoqueiro aceitar o pedido.
   */
  async assertPaidIfPartnerRequiresPrepaid(
    orderId: string,
    context: PaidAssertContext
  ): Promise<void> {
    const row = await queryOne<{ mode: string | null }>(
      `SELECT p."delivery_payment_collection_mode" AS mode
       FROM "DeliveryOrder" d
       INNER JOIN "Partner" p ON p.id = d."storeId"
       WHERE d.id = $1`,
      [orderId]
    );
    if (!row) {
      throw new Error('Pedido não encontrado');
    }
    const raw = row.mode ?? 'prepaid';
    const mode: DeliveryPaymentCollectionMode =
      raw === 'postpaid_pix' || raw === 'authorize_capture' ? raw : 'prepaid';
    if (mode !== 'prepaid') {
      return;
    }

    const paidExists = await queryOne<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM "DeliveryPayment"
       WHERE "deliveryOrderId" = $1 AND status = 'paid'`,
      [orderId]
    );
    if ((paidExists?.c ?? 0) > 0) {
      return;
    }

    const message =
      context === 'dispatch'
        ? 'Confirme o pagamento do cliente antes de chamar motociclistas (modo pré-pago da loja).'
        : 'Este pedido ainda não foi pago; o motoqueiro só pode aceitar após a confirmação do pagamento.';

    const err = new Error(message) as Error & { code?: string };
    err.code = 'PAYMENT_REQUIRED_PREPAID';
    throw err;
  }

  async getPartnerCollectionMode(storeId: string): Promise<DeliveryPaymentCollectionMode> {
    const row = await queryOne<{ delivery_payment_collection_mode: string | null }>(
      `SELECT "delivery_payment_collection_mode" FROM "Partner" WHERE id = $1`,
      [storeId]
    );
    const m = row?.delivery_payment_collection_mode ?? 'prepaid';
    if (m === 'postpaid_pix' || m === 'authorize_capture' || m === 'prepaid') {
      return m;
    }
    return 'prepaid';
  }

  async updatePartnerCollectionMode(
    storeId: string,
    mode: DeliveryPaymentCollectionMode,
    user: { partnerId?: string | null; role?: UserRole | string }
  ): Promise<void> {
    this.assertPartnerStoreAccess(user, storeId);
    await execute(
      `UPDATE "Partner" SET "delivery_payment_collection_mode" = $1, "updatedAt" = NOW() WHERE id = $2`,
      [mode, storeId]
    );
  }

  /** Cobrança inicial (checkout Asaas). Idempotência via header opcional ou novo registro por chamada com key única. */
  async initiateCheckout(params: {
    orderId: string;
    actorUser: { partnerId?: string | null; role?: UserRole | string };
    billingType?: AsaasBillingType;
    idempotencyKey?: string;
  }): Promise<DeliveryPaymentRow> {
    if (!isAsaasConfigured()) {
      throw new Error(
        'Pagamentos Asaas não configurados (defina ASAAS_API_KEY no servidor)'
      );
    }

    const order = await this.deliveryService.getOrderById(params.orderId);
    this.assertPartnerStoreAccess(params.actorUser, order.storeId);

    const paidExists = await queryOne<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM "DeliveryPayment"
       WHERE "deliveryOrderId" = $1 AND status = 'paid'`,
      [order.id]
    );
    if ((paidExists?.c ?? 0) > 0) {
      throw new Error('Pedido já possui pagamento confirmado');
    }

    const blockingStatuses: DeliveryStatus[] = [
      DeliveryStatus.completed,
      DeliveryStatus.cancelled,
    ];
    if (blockingStatuses.includes(order.status)) {
      throw new Error('Pedido não permite nova cobrança neste status');
    }

    const hasRider =
      order.riderId != null && String(order.riderId).trim() !== '';

    if (order.status === DeliveryStatus.awaiting_dispatch) {
      // pode cobrar antes de despachar
    } else if (order.status === DeliveryStatus.pending && !hasRider) {
      // loja já despachou / WhatsApp — ainda sem moto aceita
    } else {
      throw new Error(
        'Cobrança automática neste status será estendida nas próximas iterações (ex.: pós-PIX ou captura no aceite)'
      );
    }

    const splits = computeCheckoutSplits(order);
    const collectionMode = await this.getPartnerCollectionMode(order.storeId);

    const pendingReuse = await queryOne<DeliveryPaymentRow>(
      `SELECT *
       FROM "DeliveryPayment"
       WHERE "deliveryOrderId" = $1
         AND status IN ('pending', 'checkout_created')
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      [order.id]
    );
    if (
      pendingReuse?.invoiceUrl &&
      pendingReuse.asaasPaymentId &&
      pendingReuse.status === 'checkout_created'
    ) {
      return pendingReuse;
    }

    const idempotencyKey =
      params.idempotencyKey?.trim() ||
      `giro_${order.id}_${Date.now()}_${generateId().slice(-6)}`;

    const dupKey = await queryOne<{ id: string }>(
      `SELECT id FROM "DeliveryPayment" WHERE "idempotencyKey" = $1`,
      [idempotencyKey]
    );
    if (dupKey) {
      throw new Error('Chave de idempotência já utilizada');
    }

    const paymentRowId = generateId();
    const phoneDigits = normalizePhoneDigits(order.recipientPhone);
    if (phoneDigits.length < 10) {
      throw new Error(
        'Pedido sem telefone do destinatário válido para cadastro do pagador'
      );
    }

    const cpfFallback = process.env.ASAAS_FALLBACK_PAYER_CPF?.replace(/\D/g, '');
    const customerBody = {
      name: (order.recipientName ?? 'Cliente').trim().slice(0, 80),
      email: payerEmailFromPhone(phoneDigits, order.id),
      mobilePhone: phoneDigits.startsWith('55') ? phoneDigits : `55${phoneDigits}`,
      ...(cpfFallback && cpfFallback.length >= 11 ? { cpfCnpj: cpfFallback } : {}),
    };

    const customer = await asaasCreateCustomer(customerBody);

    const billingType: AsaasBillingType = params.billingType ?? 'UNDEFINED';

    const description = `Pedido ${order.storeName?.slice(0, 40) ?? ''} #${order.id.slice(-8)}`;

    const payment = await asaasCreatePayment({
      customer: String(customer.id),
      billingType,
      value: splits.customerTotal,
      dueDate: brazilDueDateToday(),
      description,
      externalReference: paymentRowId,
    });

    await execute(
      `INSERT INTO "DeliveryPayment" (
        id, "deliveryOrderId", status, "collectionMode",
        "customerTotal", "itemValueSnapshot", "deliveryFeeSnapshot",
        "platformFeeStore", "platformFeeRider", "storeNetSnapshot", "riderNetSnapshot",
        currency, "idempotencyKey", "asaasPaymentId", "asaasCustomerId",
        "invoiceUrl", "bankSlipUrl", "billingTypeRequested", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13, $14, $15,
        $16, $17, $18, NOW()
      )`,
      [
        paymentRowId,
        order.id,
        'checkout_created',
        collectionMode,
        splits.customerTotal,
        order.value,
        order.deliveryFee,
        splits.platformFeeStore,
        splits.platformFeeRider,
        splits.storeNetSnapshot,
        splits.riderNetSnapshot,
        'BRL',
        idempotencyKey,
        payment.id,
        String(customer.id),
        payment.invoiceUrl ?? null,
        payment.bankSlipUrl ?? null,
        billingType,
      ]
    );

    const row = await queryOne<DeliveryPaymentRow>(
      `SELECT * FROM "DeliveryPayment" WHERE id = $1`,
      [paymentRowId]
    );
    if (!row) throw new Error('Falha ao gravar cobrança');
    return row;
  }

  async getLatestForOrder(
    orderId: string,
    actorUser: { partnerId?: string | null; role?: UserRole | string }
  ): Promise<DeliveryPaymentRow | null> {
    const order = await this.deliveryService.getOrderById(orderId);
    this.assertPartnerStoreAccess(actorUser, order.storeId);
    return queryOne<DeliveryPaymentRow>(
      `SELECT * FROM "DeliveryPayment"
       WHERE "deliveryOrderId" = $1
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      [orderId]
    );
  }

  async syncPaymentFromAsaas(asaasPaymentId: string): Promise<void> {
    const remote = await asaasGetPayment(asaasPaymentId);
    const status = String(remote.status ?? '').toUpperCase();
    const paid =
      status === 'RECEIVED' ||
      status === 'CONFIRMED' ||
      status === 'RECEIVED_IN_CASH';

    await execute(
      `UPDATE "DeliveryPayment"
       SET status = CASE WHEN $2 THEN 'paid' ELSE status END,
           "paidAt" = CASE WHEN $2 THEN COALESCE("paidAt", NOW()) ELSE "paidAt" END,
           "updatedAt" = NOW()
       WHERE "asaasPaymentId" = $1`,
      [asaasPaymentId, paid]
    );
  }

  /** Processa webhook Asaas (event + payment). */
  async handleWebhookPayload(body: Record<string, unknown>): Promise<void> {
    const event = String(body.event ?? '');
    const paymentObj = body.payment as Record<string, unknown> | undefined;
    const pid =
      paymentObj && typeof paymentObj.id === 'string'
        ? paymentObj.id
        : typeof body.payment === 'object' &&
            body.payment !== null &&
            typeof (body.payment as any).id === 'string'
          ? String((body.payment as any).id)
          : null;

    let row =
      pid != null
        ? await queryOne<DeliveryPaymentRow>(
            `SELECT * FROM "DeliveryPayment" WHERE "asaasPaymentId" = $1`,
            [pid]
          )
        : null;

    const extRef =
      paymentObj && typeof paymentObj.externalReference === 'string'
        ? paymentObj.externalReference
        : null;
    if (!row && extRef) {
      row = await queryOne<DeliveryPaymentRow>(
        `SELECT * FROM "DeliveryPayment" WHERE id = $1`,
        [extRef]
      );
    }

    if (!row) {
      console.warn('[asaas webhook] Cobrança não mapeada', event, pid, extRef);
      return;
    }

    const remoteStatus = String(paymentObj?.status ?? '').toUpperCase();

    let nextStatus = row.status;
    let paidAt: Date | null = row.paidAt;

    if (
      ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(event) ||
      remoteStatus === 'RECEIVED' ||
      remoteStatus === 'CONFIRMED'
    ) {
      nextStatus = 'paid';
      paidAt = paidAt ?? new Date();
    }
    if (
      event.includes('REFUND') ||
      remoteStatus === 'REFUNDED' ||
      remoteStatus === 'PARTIALLY_REFUNDED'
    ) {
      nextStatus = 'refunded';
    }
    if (
      ['PAYMENT_DELETED', 'PAYMENT_CANCELLED'].includes(event) ||
      remoteStatus === 'DELETED'
    ) {
      nextStatus = 'cancelled';
    }

    await execute(
      `UPDATE "DeliveryPayment"
       SET status = $2,
           "paidAt" = $3,
           "lastWebhookEvent" = $4,
           "lastWebhookPayload" = $5::jsonb,
           "updatedAt" = NOW()
       WHERE id = $1`,
      [
        row.id,
        nextStatus,
        paidAt,
        event,
        JSON.stringify(body),
      ]
    );
  }
}
