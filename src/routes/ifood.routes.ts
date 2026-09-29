import { Router, Response } from 'express';
import { authenticateToken, requireAdmin, type AuthRequest } from '../middleware/auth';
import { IfoodOrderImportService } from '../services/ifood-order-import.service';

const router = Router();
const importer = new IfoodOrderImportService();

function routeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

router.post('/orders/:orderId/dispatch', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const orderId = routeParam(req.params.orderId).trim();
    if (!orderId) return res.status(400).json({ error: 'Informe o pedido do iFood.' });
    const result = await importer.dispatchWithoutRiders(orderId);
    return res.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Falha ao despachar pedido iFood.';
    return res.status(400).json({ error: message });
  }
});

router.post('/orders/:orderId/cancel', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const orderId = routeParam(req.params.orderId).trim();
    if (!orderId) return res.status(400).json({ error: 'Informe o pedido do iFood.' });
    const result = await importer.cancelOrder(orderId);
    return res.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Falha ao cancelar pedido iFood.';
    return res.status(400).json({ error: message });
  }
});

router.post('/sync', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const orderId = typeof req.body?.orderId === 'string' ? req.body.orderId.trim() : '';
    if (orderId) {
      const result = await importer.importOrder(orderId, req.app);
      return res.json({ results: [result] });
    }
    const results = await importer.pollLinkedMerchants(req.app);
    return res.json({ results });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Falha ao sincronizar iFood.';
    return res.status(400).json({ error: message });
  }
});

export default router;
