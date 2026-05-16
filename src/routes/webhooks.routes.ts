import { Router, Response } from 'express';
import { DeliveryPaymentService } from '../services/delivery-payment.service';

const router = Router();
const deliveryPaymentWebhookService = new DeliveryPaymentService();

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

    await deliveryPaymentWebhookService.handleWebhookPayload(
      req.body as Record<string, unknown>
    );
    res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error('[asaas webhook]', e?.message || e);
    res.status(500).json({ error: 'Webhook handler falhou' });
  }
});

export default router;
