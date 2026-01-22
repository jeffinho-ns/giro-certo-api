import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';
import { CreateBikeDto, CreateMaintenanceLogDto } from '../types';

const router = Router();

// Listar motos do usuário
router.get('/me/bikes', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const bikes = await prisma.bike.findMany({
      where: { userId: req.userId },
      include: {
        maintenanceLogs: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    res.json({ bikes });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Criar moto
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const data: CreateBikeDto = req.body;
    data.userId = req.userId;

    const bike = await prisma.bike.create({
      data: {
        userId: data.userId,
        model: data.model,
        brand: data.brand,
        plate: data.plate,
        currentKm: data.currentKm,
        oilType: data.oilType,
        frontTirePressure: data.frontTirePressure,
        rearTirePressure: data.rearTirePressure,
        photoUrl: data.photoUrl,
      },
    });

    res.status(201).json({ bike });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Buscar moto por ID
router.get('/:bikeId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { bikeId } = req.params;

    const bike = await prisma.bike.findUnique({
      where: { id: bikeId },
      include: {
        maintenanceLogs: {
          orderBy: { createdAt: 'desc' },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!bike) {
      return res.status(404).json({ error: 'Moto não encontrada' });
    }

    res.json({ bike });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Criar log de manutenção
router.post('/:bikeId/maintenance', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const { bikeId } = req.params;
    const data: CreateMaintenanceLogDto = req.body;

    // Verificar se a moto pertence ao usuário
    const bike = await prisma.bike.findUnique({
      where: { id: bikeId },
    });

    if (!bike || bike.userId !== req.userId) {
      return res.status(403).json({ error: 'Moto não encontrada ou não pertence ao usuário' });
    }

    const maintenanceLog = await prisma.maintenanceLog.create({
      data: {
        bikeId: bikeId,
        userId: req.userId,
        partName: data.partName,
        category: data.category as any,
        lastChangeKm: data.lastChangeKm,
        recommendedChangeKm: data.recommendedChangeKm,
        currentKm: data.currentKm,
        wearPercentage: data.wearPercentage,
        status: data.status as any,
      },
    });

    // Adicionar pontos de fidelidade (5 pontos por manutenção registrada)
    await prisma.user.update({
      where: { id: req.userId },
      data: {
        loyaltyPoints: { increment: 5 },
      },
    });

    res.status(201).json({ maintenanceLog });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Listar logs de manutenção
router.get('/:bikeId/maintenance', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { bikeId } = req.params;

    const logs = await prisma.maintenanceLog.findMany({
      where: { bikeId },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ logs });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
