import { WHATSAPP_ORDER_TEMPLATE_PT, looksLikeOrderFormMessage } from '../constants/whatsapp-order-template';
import { queryOne } from '../lib/db';
import { Partner } from '../types';
import { WhatsAppParser } from '../utils/whatsapp-parser';
import { DeliveryService } from './delivery.service';
import { DeliveryPaymentService } from './delivery-payment.service';
import {
  isWhatsAppCloudConfigured,
  whatsappSendTextMessage,
} from './whatsapp-cloud.service';

function formatBrl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export class WhatsAppOrderIngestService {
  private readonly deliveryService = new DeliveryService();
  private readonly paymentService = new DeliveryPaymentService();

  async resolvePartnerForPhoneNumberId(
    phoneNumberId: string
  ): Promise<Partner | null> {
    const byPhone = await queryOne<Partner>(
      `SELECT * FROM "Partner"
       WHERE whatsapp_phone_number_id = $1
         AND whatsapp_orders_enabled = true
         AND "isBlocked" = false
       LIMIT 1`,
      [phoneNumberId]
    );
    if (byPhone) return byPhone;

    const fallbackId = process.env.WHATSAPP_DEFAULT_PARTNER_ID?.trim();
    if (!fallbackId) return null;

    return queryOne<Partner>(
      `SELECT * FROM "Partner"
       WHERE id = $1 AND whatsapp_orders_enabled = true AND "isBlocked" = false`,
      [fallbackId]
    );
  }

  /**
   * Processa mensagem de texto do cliente.
   * Retorna se criou pedido, ignorou ou enviou orientação.
   */
  async processInboundText(params: {
    phoneNumberId: string;
    fromWaId: string;
    textBody: string;
  }): Promise<{ action: string; orderId?: string }> {
    if (!isWhatsAppCloudConfigured()) {
      console.warn('[WhatsApp] Webhook recebido mas WHATSAPP_CLOUD_ACCESS_TOKEN ausente');
      return { action: 'not_configured' };
    }

    const partner = await this.resolvePartnerForPhoneNumberId(params.phoneNumberId);
    if (!partner) {
      console.warn('[WhatsApp] Nenhuma loja para phone_number_id', params.phoneNumberId);
      return { action: 'unknown_phone_number_id' };
    }

    const text = params.textBody.trim();
    if (!looksLikeOrderFormMessage(text)) {
      return { action: 'ignored_not_order_form' };
    }

    let parsed;
    try {
      parsed = WhatsAppParser.parse(text);
    } catch (e: any) {
      await this.safeReply(params.phoneNumberId, params.fromWaId, [
        'Não consegui ler seu pedido. Verifique o modelo e envie de novo:',
        '',
        WHATSAPP_ORDER_TEMPLATE_PT,
        '',
        `Erro: ${e?.message || 'formato inválido'}`,
      ].join('\n'));
      return { action: 'parse_error' };
    }

    if (!parsed.confirmed) {
      await this.safeReply(
        params.phoneNumberId,
        params.fromWaId,
        'Para confirmar o pedido, altere a linha *Confirmação:* para *Sim* e envie a mensagem novamente.'
      );
      return { action: 'not_confirmed' };
    }

    if (!parsed.recipientCpf) {
      await this.safeReply(
        params.phoneNumberId,
        params.fromWaId,
        'Falta o *CPF* (obrigatório para o pagamento). Inclua a linha CPF: só números e reenvie o pedido completo.'
      );
      return { action: 'missing_cpf' };
    }

    const result = await this.deliveryService.createOrderFromWhatsAppText(
      text,
      partner.id
    );

    if (!result.created) {
      await this.safeReply(
        params.phoneNumberId,
        params.fromWaId,
        'Pedido não registrado. Use *Confirmação: Sim* no final da mensagem.'
      );
      return { action: 'not_created' };
    }

    const order = result.order;
    let paymentBlock = '';
    try {
      const { row, pixQr } = await this.paymentService.initiateCheckout({
        orderId: order.id,
        actorUser: { partnerId: partner.id },
        billingType: 'UNDEFINED',
      });

      const lines = [
        `✅ Pedido registrado em *${partner.name}*!`,
        `Total: *${formatBrl(row.customerTotal)}* (itens + entrega)`,
        '',
      ];

      if (row.invoiceUrl) {
        lines.push(`💳 Pague aqui:\n${row.invoiceUrl}`);
      }

      if (pixQr?.payload?.trim()) {
        lines.push('', '📋 PIX copia e cola:', pixQr.payload.trim());
      }

      lines.push(
        '',
        `🔐 Na entrega, informe ao motoboy os *4 últimos dígitos* do seu telefone (PIN: ${result.deliveryPin}).`,
        '',
        'Após o pagamento, a loja despacha o motoboy.'
      );

      paymentBlock = lines.join('\n');
    } catch (payErr: any) {
      console.error('[WhatsApp] Cobrança após pedido', payErr?.message);
      paymentBlock = [
        `✅ Pedido #${order.id.slice(-8)} criado, mas não foi possível gerar o link de pagamento automático.`,
        `A loja vai enviar o link em seguida.`,
        `Motivo: ${payErr?.message || 'erro Asaas'}`,
      ].join('\n');
    }

    await this.safeReply(params.phoneNumberId, params.fromWaId, paymentBlock);

    return { action: 'order_created', orderId: order.id };
  }

  private async safeReply(
    phoneNumberId: string,
    toWaId: string,
    body: string
  ): Promise<void> {
    try {
      await whatsappSendTextMessage({ phoneNumberId, toWaId, body });
    } catch (e: any) {
      console.error('[WhatsApp] Falha ao responder cliente', e?.message);
    }
  }
}
