import { queryOne, execute } from '../lib/db';
import {
  asaasCreateCustomer,
  asaasCreatePayment,
  asaasGetPixQrCode,
  isAsaasConfigured,
  AsaasBillingType,
} from './asaas.service';
import { brazilDueDateToday } from './delivery-payment.service';
import { resolvePayerCpfCnpj, normalizeCpfCnpjDigits } from '../utils/cpf-cnpj';
import { StoreCouponService } from './store-coupon.service';
import { StoreOrder, StoreOrderStatus } from '../types';

const couponService = new StoreCouponService();

export interface StoreCheckoutResult {
  status: StoreOrderStatus;
  invoiceUrl: string | null;
  billingType: AsaasBillingType;
  pix: { encodedImage?: string; payload?: string; expirationDate?: string } | null;
}

function payerEmail(phoneDigits: string, orderId: string): string {
  const safe = phoneDigits.length >= 8 ? phoneDigits.slice(-11) : phoneDigits.padStart(11, '0');
  return `cliente.${safe}.${orderId.slice(-8)}@checkout.girocerto.local`;
}

async function fetchPixQr(asaasPaymentId: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const raw = (await asaasGetPixQrCode(asaasPaymentId)) as Record<string, unknown>;
      const encodedImage = typeof raw.encodedImage === 'string' ? raw.encodedImage : undefined;
      const payload = typeof raw.payload === 'string' ? raw.payload : undefined;
      const expirationDate =
        typeof raw.expirationDate === 'string' ? raw.expirationDate : undefined;
      if ((payload && payload.trim()) || (encodedImage && encodedImage.trim())) {
        return { encodedImage, payload, expirationDate };
      }
    } catch {
      /* cobrança recém-criada pode ainda não expor o QR */
    }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  return null;
}

/**
 * Pagamento da loja virtual via Asaas. Espelha o fluxo do DeliveryPayment, mas
 * sobre o StoreOrder. O despacho só acontece após o webhook confirmar 'paid'.
 */
export class StorePaymentService {
  /** Inicia a cobrança (PIX por padrão) para um pedido aguardando pagamento. */
  async initiateCheckout(
    token: string,
    opts: { cpf?: string; billingType?: AsaasBillingType } = {}
  ): Promise<StoreCheckoutResult> {
    if (!isAsaasConfigured()) {
      throw new Error('Pagamentos Asaas não configurados (defina ASAAS_API_KEY no servidor)');
    }

    const order = await queryOne<StoreOrder>(
      `SELECT * FROM "StoreOrder" WHERE "trackingToken" = $1`,
      [token]
    );
    if (!order) throw new Error('Pedido não encontrado');
    if (order.status === StoreOrderStatus.paid) {
      throw new Error('Pedido já está pago');
    }
    if (order.status !== StoreOrderStatus.awaiting_payment) {
      throw new Error('Pedido não permite nova cobrança neste status');
    }
    if (!order.total || order.total <= 0) {
      throw new Error('Total do pedido inválido para cobrança');
    }

    const payerCpf = resolvePayerCpfCnpj(order.customerCpf, opts.cpf);
    const phoneDigits = (order.customerPhone ?? '').replace(/\D/g, '');
    if (phoneDigits.length < 10) {
      throw new Error('Telefone do cliente inválido para cadastro do pagador');
    }

    const customer = await asaasCreateCustomer({
      name: (order.customerName ?? 'Cliente').trim().slice(0, 80),
      email: payerEmail(phoneDigits, order.id),
      mobilePhone: phoneDigits.startsWith('55') ? phoneDigits : `55${phoneDigits}`,
      cpfCnpj: payerCpf,
    });

    const billingType: AsaasBillingType = opts.billingType ?? 'PIX';
    const payment = await asaasCreatePayment({
      customer: String(customer.id),
      billingType,
      value: order.total,
      dueDate: brazilDueDateToday(),
      description: `Pedido loja #${order.id.slice(-8)}`,
      externalReference: `store:${order.id}`,
    });

    // Persiste o CPF se ainda não havia (snapshot) + dados da cobrança.
    await execute(
      `UPDATE "StoreOrder"
       SET "asaasPaymentId" = $2,
           "asaasCustomerId" = $3,
           "invoiceUrl" = $4,
           "billingType" = $5,
           "paymentId" = $2,
           "customerCpf" = COALESCE("customerCpf", $6),
           "updatedAt" = NOW()
       WHERE id = $1`,
      [
        order.id,
        payment.id,
        String(customer.id),
        payment.invoiceUrl ?? null,
        billingType,
        normalizeCpfCnpjDigits(payerCpf),
      ]
    );

    const pix = billingType === 'PIX' ? await fetchPixQr(String(payment.id)) : null;

    return {
      status: StoreOrderStatus.awaiting_payment,
      invoiceUrl: payment.invoiceUrl ?? null,
      billingType,
      pix,
    };
  }

  /**
   * Trata o webhook Asaas para pedidos da loja virtual.
   * No-op se a cobrança não pertencer a um StoreOrder (a rota também chama o
   * handler do DeliveryPayment). Idempotente.
   */
  async handleWebhookPayload(body: Record<string, unknown>): Promise<boolean> {
    const event = String(body.event ?? '');
    const paymentObj = (body.payment ?? {}) as Record<string, unknown>;
    const pid = typeof paymentObj.id === 'string' ? paymentObj.id : null;
    const extRef =
      typeof paymentObj.externalReference === 'string' ? paymentObj.externalReference : null;

    let order: StoreOrder | null = null;
    if (pid) {
      order = await queryOne<StoreOrder>(
        `SELECT * FROM "StoreOrder" WHERE "asaasPaymentId" = $1`,
        [pid]
      );
    }
    if (!order && extRef && extRef.startsWith('store:')) {
      const storeOrderId = extRef.slice('store:'.length);
      order = await queryOne<StoreOrder>(`SELECT * FROM "StoreOrder" WHERE id = $1`, [storeOrderId]);
    }
    if (!order) {
      return false; // não é um pagamento da loja virtual
    }

    const remoteStatus = String(paymentObj.status ?? '').toUpperCase();
    let nextStatus: StoreOrderStatus = order.status;
    let markPaid = false;

    if (
      ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(event) ||
      remoteStatus === 'RECEIVED' ||
      remoteStatus === 'CONFIRMED'
    ) {
      if (order.status === StoreOrderStatus.awaiting_payment) {
        nextStatus = StoreOrderStatus.paid;
        markPaid = true;
      }
    } else if (
      event.includes('REFUND') ||
      remoteStatus === 'REFUNDED' ||
      remoteStatus === 'PARTIALLY_REFUNDED' ||
      ['PAYMENT_DELETED', 'PAYMENT_CANCELLED'].includes(event) ||
      remoteStatus === 'DELETED'
    ) {
      // Só cancela se ainda não foi adiante no fluxo (não despachado).
      if (order.status === StoreOrderStatus.awaiting_payment || order.status === StoreOrderStatus.paid) {
        nextStatus = StoreOrderStatus.cancelled;
      }
    }

    await execute(
      `UPDATE "StoreOrder"
       SET status = $2,
           "paidAt" = CASE WHEN $3 THEN COALESCE("paidAt", NOW()) ELSE "paidAt" END,
           "lastWebhookEvent" = $4,
           "lastWebhookPayload" = $5::jsonb,
           "updatedAt" = NOW()
       WHERE id = $1`,
      [order.id, nextStatus, markPaid, event, JSON.stringify(body)]
    );

    // Conta o uso do cupom apenas quando o pagamento é confirmado.
    if (markPaid && (order as any).couponId) {
      try {
        await couponService.incrementUsage(String((order as any).couponId));
      } catch {
        /* não bloqueia a confirmação do pagamento */
      }
    }

    return true;
  }
}
