import { Router, Response } from 'express';
import { authenticateToken, AuthRequest, requirePremium } from '../middleware/auth';
import { query, queryOne } from '../lib/db';
import { DeliveryStatus } from '../types';

const router = Router();

// Dashboard stats
router.get('/stats', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      activeRiders,
      todaysOrders,
      inProgressOrders,
      pendingOrders,
      premiumSubscribers,
      totalRevenue,
    ] = await Promise.all([
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM "User" WHERE "isOnline" = true'),
      queryOne<{ count: string }>(
        'SELECT COUNT(*) as count FROM "DeliveryOrder" WHERE "createdAt" >= $1',
        [today]
      ),
      queryOne<{ count: string }>(
        'SELECT COUNT(*) as count FROM "DeliveryOrder" WHERE status = $1',
        [DeliveryStatus.inProgress]
      ),
      queryOne<{ count: string }>(
        'SELECT COUNT(*) as count FROM "DeliveryOrder" WHERE status = $1',
        [DeliveryStatus.pending]
      ),
      queryOne<{ count: string }>(
        `SELECT COUNT(*) as count FROM "User" 
         WHERE "isSubscriber" = true AND "subscriptionType" = 'premium'`
      ),
      queryOne<{ sum: string }>(
        `SELECT COALESCE(SUM(amount), 0) as sum 
         FROM "WalletTransaction" 
         WHERE type = 'COMMISSION' AND status = 'completed'`
      ),
    ]);

    res.json({
      activeRiders: parseInt(activeRiders?.count || '0'),
      todaysOrders: parseInt(todaysOrders?.count || '0'),
      inProgressOrders: parseInt(inProgressOrders?.count || '0'),
      pendingOrders: parseInt(pendingOrders?.count || '0'),
      premiumSubscribers: parseInt(premiumSubscribers?.count || '0'),
      totalRevenue: parseFloat(totalRevenue?.sum || '0'),
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Listar pedidos recentes
router.get('/orders', authenticateToken, requirePremium, async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;

    const orders = await query(
      `SELECT do.*, 
              json_build_object('id', p.id, 'name', p.name) as partner,
              CASE 
                WHEN u.id IS NOT NULL THEN json_build_object('id', u.id, 'name', u.name)
                ELSE NULL
              END as rider
       FROM "DeliveryOrder" do
       LEFT JOIN "Partner" p ON p.id = do."storeId"
       LEFT JOIN "User" u ON u.id = do."riderId"
       ORDER BY do."createdAt" DESC
       LIMIT $1`,
      [limit]
    );

    res.json({ orders });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
