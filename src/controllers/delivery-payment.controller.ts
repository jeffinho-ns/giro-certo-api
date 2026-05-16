import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { DeliveryPaymentService } from '../services/delivery-payment.service';
import type { AsaasBillingType } from '../services/asaas.service';

const service = new DeliveryPaymentService();

export class DeliveryPaymentController {
  async initiate(req: AuthRequest, res: Response) {
    try {
      const orderId = Array.isArray(req.params.orderId)
        ? req.params.orderId[0]
        : req.params.orderId;
      const billingType = req.body?.billingType as AsaasBillingType | undefined;
      const idempotencyKey =
        typeof req.body?.idempotencyKey === 'string'
          ? req.body.idempotencyKey
          : (() => {
              const h = req.headers['idempotency-key'];
              if (typeof h === 'string') return h;
              if (Array.isArray(h) && typeof h[0] === 'string') return h[0];
              return undefined;
            })();

      const row = await service.initiateCheckout({
        orderId,
        actorUser: req.user,
        billingType,
        idempotencyKey,
      });

      res.status(201).json({
        payment: {
          id: row.id,
          status: row.status,
          customerTotal: row.customerTotal,
          itemValueSnapshot: row.itemValueSnapshot,
          deliveryFeeSnapshot: row.deliveryFeeSnapshot,
          platformFeeStore: row.platformFeeStore,
          platformFeeRider: row.platformFeeRider,
          storeNetSnapshot: row.storeNetSnapshot,
          riderNetSnapshot: row.riderNetSnapshot,
          collectionMode: row.collectionMode,
          invoiceUrl: row.invoiceUrl,
          bankSlipUrl: row.bankSlipUrl,
          asaasPaymentId: row.asaasPaymentId,
        },
      });
    } catch (e: any) {
      const msg = e?.message || 'Erro ao criar cobrança';
      const code =
        msg.includes('Sem permissão') || msg.includes('não permite')
          ? 403
          : msg.includes('já possui') || msg.includes('idempotência')
            ? 409
            : 400;
      res.status(code).json({ error: msg });
    }
  }

  async latest(req: AuthRequest, res: Response) {
    try {
      const orderId = Array.isArray(req.params.orderId)
        ? req.params.orderId[0]
        : req.params.orderId;
      const row = await service.getLatestForOrder(orderId, req.user);
      if (!row) {
        return res.status(404).json({ error: 'Nenhuma cobrança registrada' });
      }
      res.json({
        payment: {
          id: row.id,
          status: row.status,
          customerTotal: row.customerTotal,
          platformFeeStore: row.platformFeeStore,
          platformFeeRider: row.platformFeeRider,
          storeNetSnapshot: row.storeNetSnapshot,
          riderNetSnapshot: row.riderNetSnapshot,
          collectionMode: row.collectionMode,
          invoiceUrl: row.invoiceUrl,
          paidAt: row.paidAt,
          asaasPaymentId: row.asaasPaymentId,
        },
      });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'Erro' });
    }
  }
}
