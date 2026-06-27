import { Router, Request, Response } from 'express';
import { DeliveryPaymentService } from '../services/delivery-payment.service';
import { StorePaymentService } from '../services/store-payment.service';
import { WhatsAppOrderIngestService } from '../services/whatsapp-order-ingest.service';
import {
  extractInboundTextMessages,
  verifyWhatsAppWebhookToken,
} from '../services/whatsapp-cloud.service';

const router = Router();
const deliveryPaymentWebhookService = new DeliveryPaymentService();
const storePaymentWebhookService = new StorePaymentService();
const whatsappOrderIngest = new WhatsAppOrderIngestService();

router.post('/asaas', async (req, res: Response) => {
  try {
    const expected = process.env.ASAAS_WEBHOOK_TOKEN?.trim();
    const received = req.get('asaas-access-token');
    if (expected) {
      if (!received || received !== expected) {
        return res.status(401).json({ error: 'Webhook não autorizado' });
      }
    } else if (process.env.NODE_ENV === 'production') {
      console.warn('[asaas webhook] ASAAS_WEBHOOK_TOKEN não definido em produção');
    }

    const body = req.body as Record<string, unknown>;
    // Primeiro tenta como pagamento da loja virtual; se não for, trata como entrega.
    const handledByStore = await storePaymentWebhookService.handleWebhookPayload(body);
    if (!handledByStore) {
      await deliveryPaymentWebhookService.handleWebhookPayload(body);
    }
    res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error('[asaas webhook]', e?.message || e);
    res.status(500).json({ error: 'Webhook handler falhou' });
  }
});

/** Verificação do webhook Meta (WhatsApp Cloud API). */
router.get('/whatsapp', (req: Request, res: Response) => {
  const mode = String(req.query['hub.mode'] ?? '');
  const token = String(req.query['hub.verify_token'] ?? '');
  const challenge = req.query['hub.challenge'];

  if (verifyWhatsAppWebhookToken(mode, token) && challenge != null) {
    return res.status(200).send(String(challenge));
  }
  return res.status(403).send('Forbidden');
});

/** Mensagens recebidas no número WhatsApp Business da loja. */
router.post('/whatsapp', async (req: Request, res: Response) => {
  try {
    const messages = extractInboundTextMessages(req.body);
    for (const msg of messages) {
      const result = await whatsappOrderIngest.processInboundText({
        phoneNumberId: msg.phoneNumberId,
        fromWaId: msg.fromWaId,
        textBody: msg.textBody,
      });
      console.info('[whatsapp webhook]', {
        from: msg.fromWaId,
        action: result.action,
        orderId: result.orderId,
      });
    }
    res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error('[whatsapp webhook]', e?.message || e);
    res.status(200).json({ ok: true });
  }
});

export default router;
