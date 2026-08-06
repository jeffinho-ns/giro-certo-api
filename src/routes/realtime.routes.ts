import { Router, Request, Response } from 'express';
import { UserRole } from '../types';
import { subscribeSse } from '../utils/sse-hub';
import {
  canJoinOrderTrackingRoom,
  resolveDeliveryOrderIdByTrackingToken,
  resolveSocketUserFromToken,
} from '../utils/socket-events';

const router = Router();

function extractToken(req: Request): string | null {
  const q = String(req.query.token ?? '').trim();
  if (q) return q;
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return null;
}

/**
 * SSE autenticado — canais: user:{id}, store:{partnerId}, role:admin, order:{id} (opcional).
 * EventSource no browser: ?token=JWT (header Authorization não funciona no EventSource).
 */
router.get('/stream', async (req: Request, res: Response) => {
  try {
    const token = extractToken(req);
    const user = await resolveSocketUserFromToken(token);
    if (!user) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }

    const channels: string[] = [`user:${user.id}`];
    if (user.partnerId) channels.push(`store:${user.partnerId}`);
    if (user.role === UserRole.ADMIN || user.role === UserRole.MODERATOR) {
      channels.push('role:admin');
    }

    const orderId = String(req.query.orderId ?? '').trim();
    if (orderId) {
      const allowed = await canJoinOrderTrackingRoom(user, orderId);
      if (!allowed) {
        res.status(403).json({ error: 'Sem permissão para acompanhar este pedido' });
        return;
      }
      channels.push(`order:${orderId}`);
    }

    subscribeSse(res, channels);
  } catch (e: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: e?.message ?? 'Falha ao abrir stream' });
    }
  }
});

/**
 * SSE público — cliente da vitrine acompanha pedido por trackingToken (sem JWT).
 */
router.get('/store-order/:trackingToken/stream', async (req: Request, res: Response) => {
  try {
    const trackingToken = String(req.params.trackingToken ?? '').trim();
    if (trackingToken.length < 16) {
      res.status(400).json({ error: 'Token inválido' });
      return;
    }

    const channels = [`store-order:${trackingToken}`];
    const deliveryOrderId = await resolveDeliveryOrderIdByTrackingToken(trackingToken);
    if (deliveryOrderId) {
      channels.push(`order:${deliveryOrderId}`);
    }

    subscribeSse(res, channels);
  } catch (e: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: e?.message ?? 'Falha ao abrir stream' });
    }
  }
});

export default router;
