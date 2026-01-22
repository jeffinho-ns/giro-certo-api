import { Router, Response } from 'express';
import { authenticateToken, AuthRequest, requirePremium } from '../middleware/auth';
import prisma from '../lib/prisma';
import { DeliveryStatus } from '@prisma/client';

const router = Router();

// Dashboard stats (apenas autenticados)
router.get('/stats', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      activeRiders,
      todaysOrders,
      inProgressOrders,
      pendingOrders,
      premiumSubscribers,
      totalRevenue,
    ] = await Promise.all([
      // Motociclistas online
      prisma.user.count({
        where: { isOnline: true },
      }),
      // Pedidos de hoje
      prisma.deliveryOrder.count({
        where: {
          createdAt: { gte: today },
        },
      }),
      // Pedidos em andamento
      prisma.deliveryOrder.count({
        where: { status: DeliveryStatus.inProgress },
      }),
      // Pedidos pendentes
      prisma.deliveryOrder.count({
        where: { status: DeliveryStatus.pending },
      }),
      // Assinantes Premium
      prisma.user.count({
        where: {
          isSubscriber: true,
          subscriptionType: 'premium',
        },
      }),
      // Receita total (comissões)
      prisma.walletTransaction.aggregate({
        where: {
          type: 'COMMISSION',
          status: 'completed',
        },
        _sum: { amount: true },
      }),
    ]);

    res.json({
      activeRiders,
      todaysOrders,
      inProgressOrders,
      pendingOrders,
      premiumSubscribers,
      totalRevenue: totalRevenue._sum.amount || 0,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Mapa de calor (apenas Premium)
router.get('/heatmap', authenticateToken, requirePremium, async (req: AuthRequest, res: Response) => {
  try {
    // Buscar pedidos completos dos últimos 30 dias
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const orders = await prisma.deliveryOrder.findMany({
      where: {
        status: DeliveryStatus.completed,
        completedAt: { gte: thirtyDaysAgo },
      },
      select: {
        deliveryLatitude: true,
        deliveryLongitude: true,
        storeLatitude: true,
        storeLongitude: true,
      },
    });

    // Agrupar por localização (arredondar para ~100m)
    const heatmap: Record<string, number> = {};

    orders.forEach((order) => {
      // Loja
      const storeKey = `${order.storeLatitude.toFixed(3)},${order.storeLongitude.toFixed(3)}`;
      heatmap[storeKey] = (heatmap[storeKey] || 0) + 1;

      // Entrega
      const deliveryKey = `${order.deliveryLatitude.toFixed(3)},${order.deliveryLongitude.toFixed(3)}`;
      heatmap[deliveryKey] = (heatmap[deliveryKey] || 0) + 1;
    });

    // Converter para array
    const heatmapData = Object.entries(heatmap).map(([key, count]) => {
      const [lat, lng] = key.split(',').map(parseFloat);
      return { latitude: lat, longitude: lng, count };
    });

    res.json({ heatmap: heatmapData });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Estatísticas financeiras
router.get('/financial', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    // Comissões por tipo
    const [premiumCommissions, standardCommissions] = await Promise.all([
      prisma.walletTransaction.aggregate({
        where: {
          type: 'COMMISSION',
          status: 'completed',
          amount: 3.0,
          createdAt: { gte: sixMonthsAgo },
        },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.walletTransaction.aggregate({
        where: {
          type: 'COMMISSION',
          status: 'completed',
          amount: 1.0,
          createdAt: { gte: sixMonthsAgo },
        },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    // Receita total
    const totalRevenue = await prisma.walletTransaction.aggregate({
      where: {
        type: 'COMMISSION',
        status: 'completed',
      },
      _sum: { amount: true },
    });

    // Saques pendentes
    const pendingWithdrawals = await prisma.walletTransaction.aggregate({
      where: {
        type: 'WITHDRAWAL',
        status: 'pending',
      },
      _sum: { amount: true },
    });

    // Comissões por mês (últimos 6 meses)
    const monthlyCommissions = await prisma.walletTransaction.groupBy({
      by: ['createdAt'],
      where: {
        type: 'COMMISSION',
        status: 'completed',
        createdAt: { gte: sixMonthsAgo },
      },
      _sum: { amount: true },
      _count: true,
    });

    res.json({
      totalRevenue: totalRevenue._sum.amount || 0,
      premiumCommissions: {
        total: premiumCommissions._sum.amount || 0,
        count: premiumCommissions._count || 0,
      },
      standardCommissions: {
        total: standardCommissions._sum.amount || 0,
        count: standardCommissions._count || 0,
      },
      pendingWithdrawals: pendingWithdrawals._sum.amount || 0,
      monthlyBreakdown: monthlyCommissions,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
