import { Router } from 'express';
import { Request, Response } from 'express';
import prisma from '@/lib/prisma';
import { authenticateToken } from '@/middleware/auth';
import { Request, Response } from 'express';
import { UpdateUserLocationDto } from '@/types';

const router = Router();

// Buscar todos os usuários (admin)
router.get('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        age: true,
        photoUrl: true,
        pilotProfile: true,
        isSubscriber: true,
        subscriptionType: true,
        loyaltyPoints: true,
        currentLat: true,
        currentLng: true,
        isOnline: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ users });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Buscar usuário por ID
router.get('/:userId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        age: true,
        photoUrl: true,
        pilotProfile: true,
        isSubscriber: true,
        subscriptionType: true,
        loyaltyPoints: true,
        currentLat: true,
        currentLng: true,
        isOnline: true,
        createdAt: true,
        bikes: true,
        wallet: {
          include: {
            transactions: {
              orderBy: { createdAt: 'desc' },
              take: 10,
            },
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    res.json({ user });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Buscar perfil do usuário autenticado
router.get('/me/profile', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        name: true,
        email: true,
        age: true,
        photoUrl: true,
        pilotProfile: true,
        isSubscriber: true,
        subscriptionType: true,
        loyaltyPoints: true,
        currentLat: true,
        currentLng: true,
        isOnline: true,
        bikes: {
          include: {
            maintenanceLogs: {
              orderBy: { createdAt: 'desc' },
              take: 5,
            },
          },
        },
        wallet: {
          include: {
            transactions: {
              orderBy: { createdAt: 'desc' },
              take: 20,
            },
          },
        },
        deliveryOrders: {
          where: {
            status: {
              in: ['accepted', 'inProgress'],
            },
          },
          take: 5,
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    res.json({ user });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Atualizar localização do usuário
router.patch('/me/location', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const data: UpdateUserLocationDto = req.body;

    const user = await prisma.user.update({
      where: { id: req.userId },
      data: {
        currentLat: data.latitude,
        currentLng: data.longitude,
        lastLocationUpdate: new Date(),
        isOnline: data.isOnline !== undefined ? data.isOnline : true,
      },
      select: {
        id: true,
        name: true,
        currentLat: true,
        currentLng: true,
        isOnline: true,
        lastLocationUpdate: true,
      },
    });

    res.json({ user });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Listar assinantes Premium
router.get('/subscribers/premium', authenticateToken, async (req: Request, res: Response) => {
  try {
    const subscribers = await prisma.user.findMany({
      where: {
        isSubscriber: true,
        subscriptionType: 'premium',
      },
      select: {
        id: true,
        name: true,
        email: true,
        loyaltyPoints: true,
        isOnline: true,
        currentLat: true,
        currentLng: true,
        createdAt: true,
        deliveryOrders: {
          where: {
            status: 'completed',
          },
          select: {
            id: true,
            appCommission: true,
            completedAt: true,
          },
        },
        ratings: {
          where: {
            deliveryOrderId: { not: null },
          },
          select: {
            rating: true,
          },
        },
      },
      orderBy: { loyaltyPoints: 'desc' },
    });

    // Calcular estatísticas adicionais
    const subscribersWithStats = subscribers.map((sub) => {
      const totalDeliveries = sub.deliveryOrders.length;
      const totalEarnings = sub.deliveryOrders.reduce(
        (sum, order) => sum + order.appCommission,
        0
      );
      const averageRating =
        sub.ratings.length > 0
          ? sub.ratings.reduce((sum, r) => sum + r.rating, 0) / sub.ratings.length
          : 0;

      return {
        ...sub,
        totalDeliveries,
        totalEarnings,
        averageRating: parseFloat(averageRating.toFixed(1)),
      };
    });

    res.json({ subscribers: subscribersWithStats });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
