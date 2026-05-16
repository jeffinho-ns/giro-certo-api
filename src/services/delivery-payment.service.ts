import { generateId } from '../utils/id';
import { queryOne, execute, query } from '../lib/db';
import { DeliveryOrder, DeliveryStatus, UserRole } from '../types';
import { DeliveryService } from './delivery.service';
import {
  asaasCreateCustomer,
  asaasCreatePayment,
  asaasGetPayment,
  asaasGetPixQrCode,
  isAsaasConfigured,
  AsaasBillingType,
} from './asaas.service';
import { DeliverySettlementLedgerService } from './delivery-settlement-ledger.service';

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

/**
 * Lê status da cobrança no Asaas e devolve próximo estado local + se deve registar ledger.
 */
export function nextDeliveryPaymentStatusFromAsaasRemote(
  row: Pick<DeliveryPaymentRow, 'status' | 'paidAt'>,
  remote: Record<string, unknown>
): { nextStatus: string; paidAt: Date | null; markPaidLedger: boolean } {
  const remoteStatus = String(remote.status ?? '').toUpperCase();
  let nextStatus = row.status;
  let paidAt = row.paidAt;
  let markPaidLedger = false;

  if (
    remoteStatus === 'RECEIVED' ||
    remoteStatus === 'CONFIRMED' ||
    remoteStatus === 'RECEIVED_IN_CASH'
  ) {
    nextStatus = 'paid';
    paidAt = paidAt ?? new Date();
    markPaidLedger = row.status !== 'paid';
  } else if (
    remoteStatus === 'REFUNDED' ||
    remoteStatus === 'PARTIALLY_REFUNDED'
  ) {
    nextStatus = 'refunded';
  } else if (remoteStatus === 'DELETED') {
    nextStatus = 'cancelled';
  } else if (remoteStatus === 'OVERDUE') {
    nextStatus = 'expired';
  } else if (
    remoteStatus === 'PENDING' ||
    remoteStatus === 'AWAITING_PAYMENT' ||
    remoteStatus === 'AWAITING_RISK_ANALYSIS'
  ) {
    if (row.status === 'pending') {
      nextStatus = 'checkout_created';
    }
  }

  return { nextStatus, paidAt, markPaidLedger };
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

/** Dados do QR PIX retornados pelo Asaas (GET `/payments/:id/pixQrCode`). */
export interface PixQrForPayment {
  /** PNG em base64 (costuma vir sem prefixo `data:image/...`). */
  encodedImage?: string;
  /** Código PIX “copia e cola” para o cliente no WhatsApp. */
  payload?: string;
  expirationDate?: string;
}

export type InitiateCheckoutResult = {
  row: DeliveryPaymentRow;
  pixQr: PixQrForPayment | null;
};

function mapAsaasPixQr(raw: Record<string, unknown>): PixQrForPayment {
  const encodedImage =
    typeof raw.encodedImage === 'string'
      ? raw.encodedImage
      : typeof raw.encoded_image === 'string'
        ? String(raw.encoded_image)
        : undefined;
  const payload =
    typeof raw.payload === 'string'
      ? raw.payload
      : typeof raw.copyPaste === 'string'
        ? String(raw.copyPaste)
        : undefined;
  const expirationDate =
    typeof raw.expirationDate === 'string'
      ? raw.expirationDate
      : typeof raw.expiresDate === 'string'
        ? raw.expiresDate
        : undefined;
  return { encodedImage, payload, expirationDate };
}

async function fetchPixQrWithRetry(
  asaasPaymentId: string
): Promise<PixQrForPayment | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const raw = (await asaasGetPixQrCode(asaasPaymentId)) as Record<
        string,
        unknown
      >;
      const mapped = mapAsaasPixQr(raw);
      if (
        (mapped.payload && mapped.payload.trim()) ||
        (mapped.encodedImage && mapped.encodedImage.trim())
      ) {
        return mapped;
      }
    } catch {
      /* cobrança recém criada pode ainda não expor o QR */
    }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  return null;
}

export type PaidAssertContext = 'dispatch' | 'accept_rider';

/** Default Asaas `billingType` quando o cliente não envia um explícito. */
export function resolveInitiateBillingType(
  collectionMode: DeliveryPaymentCollectionMode,
  explicit?: AsaasBillingType
): AsaasBillingType {
  if (explicit) return explicit;
  if (collectionMode === 'postpaid_pix') return 'PIX';
  if (collectionMode === 'authorize_capture') return 'CREDIT_CARD';
  return 'UNDEFINED';
}

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

  /** PIX em aberto: útil para mandar “copia e cola” ou imagem no WhatsApp de novo. */
  async getPixQrForOpenPayment(
    row: DeliveryPaymentRow
  ): Promise<PixQrForPayment | null> {
    if (row.billingTypeRequested !== 'PIX' || !row.asaasPaymentId) return null;
    if (['paid', 'refunded', 'cancelled', 'expired'].includes(row.status)) {
      return null;
    }
    return fetchPixQrWithRetry(row.asaasPaymentId);
  }

  /** Cobrança inicial (checkout Asaas). Idempotência via header opcional ou novo registro por chamada com key única. */
  async initiateCheckout(params: {
    orderId: string;
    actorUser: { partnerId?: string | null; role?: UserRole | string };
    billingType?: AsaasBillingType;
    idempotencyKey?: string;
  }): Promise<InitiateCheckoutResult> {
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

    const collectionMode = await this.getPartnerCollectionMode(order.storeId);
    const allowLateInitiate =
      collectionMode === 'postpaid_pix' || collectionMode === 'authorize_capture';

    const hasRider =
      order.riderId != null && String(order.riderId).trim() !== '';

    /** Cobrança “tardia” durante a corrida (PIX pós ou captura quando existir fluxo correspondente no Asaas). */
    const activeDeliveryStatuses: DeliveryStatus[] = [
      DeliveryStatus.accepted,
      DeliveryStatus.arrivedAtStore,
      DeliveryStatus.inTransit,
      DeliveryStatus.arrivedAtDestination,
      DeliveryStatus.inProgress,
    ];

    if (order.status === DeliveryStatus.awaiting_dispatch) {
      // pode cobrar antes de despachar
    } else if (order.status === DeliveryStatus.pending && !hasRider) {
      // loja já despachou / WhatsApp — ainda sem moto aceita
    } else if (allowLateInitiate && activeDeliveryStatuses.includes(order.status)) {
      // modo pós-pagamento ou captura: checkout durante execução
    } else {
      throw new Error(
        'Cobrança neste estado não está permitida para o modo atual da loja (use pré‑pago no despacho ou configure postpaid_pix / authorize_capture).'
      );
    }

    const splits = computeCheckoutSplits(order);

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
      const pixQr =
        pendingReuse.billingTypeRequested === 'PIX'
          ? await fetchPixQrWithRetry(pendingReuse.asaasPaymentId)
          : null;
      return { row: pendingReuse, pixQr };
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

    const billingType: AsaasBillingType = resolveInitiateBillingType(
      collectionMode,
      params.billingType
    );

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
    const pixQr =
      billingType === 'PIX' && row.asaasPaymentId
        ? await fetchPixQrWithRetry(row.asaasPaymentId)
        : null;
    return { row, pixQr };
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
    const row = await queryOne<DeliveryPaymentRow>(
      `SELECT * FROM "DeliveryPayment" WHERE "asaasPaymentId" = $1`,
      [asaasPaymentId]
    );
    if (!row) return;

    const { nextStatus, paidAt, markPaidLedger } = nextDeliveryPaymentStatusFromAsaasRemote(
      row,
      remote as Record<string, unknown>
    );

    await execute(
      `UPDATE "DeliveryPayment"
       SET status = $2,
           "paidAt" = COALESCE($3, "paidAt"),
           "lastWebhookEvent" = COALESCE("lastWebhookEvent", 'reconcile_poll'),
           "updatedAt" = NOW()
       WHERE id = $1`,
      [row.id, nextStatus, paidAt]
    );

    if (markPaidLedger && nextStatus === 'paid') {
      const updated = await queryOne<DeliveryPaymentRow>(
        `SELECT * FROM "DeliveryPayment" WHERE id = $1`,
        [row.id]
      );
      if (updated) {
        try {
          await new DeliverySettlementLedgerService().recordPaidDeliveryPayment({
            id: updated.id,
            deliveryOrderId: updated.deliveryOrderId,
            storeNetSnapshot: updated.storeNetSnapshot,
            riderNetSnapshot: updated.riderNetSnapshot,
            platformFeeStore: updated.platformFeeStore,
            platformFeeRider: updated.platformFeeRider,
            customerTotal: updated.customerTotal,
          });
        } catch (_) {
          /* idempotent */
        }
      }
    }
  }

  /**
   * Pesquisa cobranças abertas e alinha estado com GET `/payments/:id` (cron ou admin).
   */
  async reconcileOpenPayments(limit = 80): Promise<{
    scanned: number;
    updated: number;
    failures: Array<{ paymentId: string; error: string }>;
  }> {
    if (!isAsaasConfigured()) {
      throw new Error('ASAAS_API_KEY não configurada');
    }
    const lim = Math.min(Math.max(limit, 1), 200);
    const rows = await query<DeliveryPaymentRow>(
      `SELECT * FROM "DeliveryPayment"
       WHERE "asaasPaymentId" IS NOT NULL
         AND status NOT IN ('paid', 'refunded', 'cancelled')
       ORDER BY "updatedAt" ASC
       LIMIT $1`,
      [lim]
    );

    let updated = 0;
    const failures: Array<{ paymentId: string; error: string }> = [];

    for (const row of rows) {
      const pid = row.asaasPaymentId;
      if (!pid) continue;
      try {
        const remote = (await asaasGetPayment(pid)) as Record<string, unknown>;
        const mapped = nextDeliveryPaymentStatusFromAsaasRemote(row, remote);
        const statusChanged = mapped.nextStatus !== row.status;
        const paidBecameSet = Boolean(mapped.paidAt) && !row.paidAt;
        if (!statusChanged && !paidBecameSet) {
          continue;
        }

        await execute(
          `UPDATE "DeliveryPayment"
           SET status = $2,
               "paidAt" = COALESCE($3, "paidAt"),
               "lastWebhookEvent" = COALESCE("lastWebhookEvent", 'reconcile_poll'),
               "updatedAt" = NOW()
           WHERE id = $1`,
          [row.id, mapped.nextStatus, mapped.paidAt]
        );
        updated += 1;

        if (mapped.markPaidLedger && mapped.nextStatus === 'paid') {
          const fresh = await queryOne<DeliveryPaymentRow>(
            `SELECT * FROM "DeliveryPayment" WHERE id = $1`,
            [row.id]
          );
          if (fresh) {
            try {
              await new DeliverySettlementLedgerService().recordPaidDeliveryPayment({
                id: fresh.id,
                deliveryOrderId: fresh.deliveryOrderId,
                storeNetSnapshot: fresh.storeNetSnapshot,
                riderNetSnapshot: fresh.riderNetSnapshot,
                platformFeeStore: fresh.platformFeeStore,
                platformFeeRider: fresh.platformFeeRider,
                customerTotal: fresh.customerTotal,
              });
            } catch (_) {
              /* idempotent */
            }
          }
        }
      } catch (e: any) {
        failures.push({
          paymentId: row.id,
          error: e?.message || String(e),
        });
      }
    }

    return { scanned: rows.length, updated, failures };
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

    if (nextStatus === 'paid') {
      try {
        const ledger = new DeliverySettlementLedgerService();
        await ledger.recordPaidDeliveryPayment({
          id: row.id,
          deliveryOrderId: row.deliveryOrderId,
          storeNetSnapshot: row.storeNetSnapshot,
          riderNetSnapshot: row.riderNetSnapshot,
          platformFeeStore: row.platformFeeStore,
          platformFeeRider: row.platformFeeRider,
          customerTotal: row.customerTotal,
        });
      } catch (ledgerErr: any) {
        console.error(
          '[DeliverySettlementLedger] Falha ao registrar repasse:',
          ledgerErr?.message ?? ledgerErr
        );
      }
    }
  }
}
