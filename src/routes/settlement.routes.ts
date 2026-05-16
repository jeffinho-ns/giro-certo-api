import { Router, Request, Response } from 'express';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth';
import { DeliverySettlementLedgerService } from '../services/delivery-settlement-ledger.service';
import { DeliverySettlementBatchService } from '../services/delivery-settlement-batch.service';
import { DeliveryPaymentService } from '../services/delivery-payment.service';

const router = Router();
const settlementLedgerService = new DeliverySettlementLedgerService();
const settlementBatchService = new DeliverySettlementBatchService();
const deliveryPaymentService = new DeliveryPaymentService();

/** Resumo execuativo: repasses pendentes agrupados (ainda sem lote). */
router.get(
  '/ledger/pending-summary',
  authenticateToken,
  requireAdmin,
  async (_req: AuthRequest, res: Response) => {
    try {
      const summary = await settlementLedgerService.getPendingSummary();
      res.json({ summary });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'Erro ao ler livro de repasses' });
    }
  }
);

/** Monta lotes a partir de todas as linhas `pending` sem `settlement_batch_id`. */
router.post(
  '/batches/compose-from-ledger',
  authenticateToken,
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const cutoffAt =
        typeof req.body?.cutoffAt === 'string' ? req.body.cutoffAt : undefined;
      const result = await settlementBatchService.composeBatchesFromLedger(
        cutoffAt ? { cutoffAt } : undefined
      );
      res.status(201).json({
        ok: true,
        ...result,
      });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'Erro ao compor lotes' });
    }
  }
);

/**
 * Mesmo efeito de `compose-from-ledger`, sem JWT — para Cron jobs (Render, etc.).
 * Header `x-giro-cron-secret` = valor de `GIRO_CRON_SECRET`.
 */
router.post('/batches/compose-scheduled', async (req: Request, res: Response) => {
  try {
    const expected = process.env.GIRO_CRON_SECRET?.trim();
    const rawHeader = req.headers['x-giro-cron-secret'];
    const received =
      typeof rawHeader === 'string'
        ? rawHeader
        : Array.isArray(rawHeader)
          ? rawHeader[0]
          : '';

    if (!expected || received !== expected) {
      return res.status(401).json({ error: 'Cron não autorizado' });
    }

    const cutoffRaw = (req.body as { cutoffAt?: string } | undefined)?.cutoffAt;
    const cutoffAt = typeof cutoffRaw === 'string' ? cutoffRaw : undefined;

    const result = await settlementBatchService.composeBatchesFromLedger(
      cutoffAt ? { cutoffAt } : undefined
    );
    res.status(201).json({ ok: true, ...result });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Erro ao compor lotes (cron)' });
  }
});

router.get(
  '/batches',
  authenticateToken,
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 40;
      const status =
        typeof req.query.status === 'string' && req.query.status.length > 0
          ? req.query.status
          : undefined;
      const batches = await settlementBatchService.listBatches(limit, { status });
      res.json({ batches });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'Erro ao listar lotes' });
    }
  }
);

router.get(
  '/batches/:batchId',
  authenticateToken,
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const batchId = Array.isArray(req.params.batchId)
        ? req.params.batchId[0]
        : req.params.batchId;
      const batch = await settlementBatchService.getBatchById(batchId);
      if (!batch) {
        return res.status(404).json({ error: 'Lote não encontrado' });
      }
      res.json({ batch });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'Erro ao buscar lote' });
    }
  }
);

/** Dispara transferência no Asaas (`/transfers`). Ver documentação Asaas para `bankAccount`. */
router.post(
  '/batches/:batchId/execute-transfer',
  authenticateToken,
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const batchId = Array.isArray(req.params.batchId)
        ? req.params.batchId[0]
        : req.params.batchId;
      const bankAccount = req.body?.bankAccount;
      const bankOk =
        bankAccount !== undefined &&
        bankAccount !== null &&
        typeof bankAccount === 'object' &&
        !Array.isArray(bankAccount);

      const description =
        typeof req.body?.description === 'string' ? req.body.description : undefined;
      const out = await settlementBatchService.executeOutboundTransfer({
        batchId,
        bankAccount: bankOk ? (bankAccount as Record<string, unknown>) : undefined,
        description,
      });
      res.json({ ok: true, ...out });
    } catch (e: any) {
      const msg = e?.message || 'Falha ao executar transferência';
      const code = msg.includes('desativadas') || msg.includes('não configurada') ? 503 : 400;
      res.status(code).json({ error: msg });
    }
  }
);

/** Alinha cobranças em aberto com GET `/payments/:id` no Asaas (admin). */
router.post('/reconcile/payments', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const lim = req.body?.limit != null ? parseInt(String(req.body.limit), 10) : 80;
    const result = await deliveryPaymentService.reconcileOpenPayments(Number.isFinite(lim) ? lim : 80);
    res.json({ ok: true, ...result });
  } catch (e: any) {
    const msg = e?.message || 'Erro na reconciliação de cobranças';
    const code = msg.includes('não configurada') ? 503 : 400;
    res.status(code).json({ error: msg });
  }
});

/** Consulta estado de transferências já executadas; marca lote `transfer_failed` se o Asaas reportar falha. */
router.post('/reconcile/transfers', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const lim = req.body?.limit != null ? parseInt(String(req.body.limit), 10) : 60;
    const result = await settlementBatchService.reconcileExecutedTransfers(
      Number.isFinite(lim) ? lim : 60
    );
    res.json({ ok: true, ...result });
  } catch (e: any) {
    const msg = e?.message || 'Erro na reconciliação de transferências';
    const code = msg.includes('não configurada') ? 503 : 400;
    res.status(code).json({ error: msg });
  }
});

/**
 * Reconciliação por cron (`x-giro-cron-secret` = `GIRO_CRON_SECRET`).
 * Body opcional: `{ payments?: boolean, transfers?: boolean, paymentLimit?, transferLimit? }` (defaults: ambos true).
 */
router.post('/reconcile-scheduled', async (req: Request, res: Response) => {
  try {
    const expected = process.env.GIRO_CRON_SECRET?.trim();
    const rawHeader = req.headers['x-giro-cron-secret'];
    const received =
      typeof rawHeader === 'string'
        ? rawHeader
        : Array.isArray(rawHeader)
          ? rawHeader[0]
          : '';

    if (!expected || received !== expected) {
      return res.status(401).json({ error: 'Cron não autorizado' });
    }

    const body = (req.body || {}) as {
      payments?: boolean;
      transfers?: boolean;
      paymentLimit?: number;
      transferLimit?: number;
    };
    const doPay = body.payments !== false;
    const doTx = body.transfers !== false;
    const plim =
      body.paymentLimit != null && Number.isFinite(Number(body.paymentLimit))
        ? Number(body.paymentLimit)
        : 80;
    const tlim =
      body.transferLimit != null && Number.isFinite(Number(body.transferLimit))
        ? Number(body.transferLimit)
        : 60;

    const payload: Record<string, unknown> = { ok: true };
    if (doPay) {
      payload.payments = await deliveryPaymentService.reconcileOpenPayments(plim);
    }
    if (doTx) {
      payload.transfers = await settlementBatchService.reconcileExecutedTransfers(tlim);
    }

    res.json(payload);
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Erro reconcile-scheduled' });
  }
});

export default router;
