import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { query, queryOne } from '../lib/db';
import { CreateBikeDto, CreateMaintenanceLogDto, Bike, MaintenanceLog, User } from '../types';
import { generateId } from '../utils/id';

const router = Router();

// Listar motos do usuário
router.get('/me/bikes', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const bikes = await query<Bike & { maintenanceLogs: MaintenanceLog[] }>(
      `SELECT 
        b.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', ml.id,
              'partName', ml."partName",
              'category', ml.category,
              'status', ml.status,
              'createdAt', ml."createdAt"
            ) ORDER BY ml."createdAt" DESC
          ) FILTER (WHERE ml.id IS NOT NULL),
          '[]'::json
        ) as "maintenanceLogs"
       FROM "Bike" b
       LEFT JOIN "MaintenanceLog" ml ON ml."bikeId" = b.id
       WHERE b."userId" = $1
       GROUP BY b.id`,
      [req.userId]
    );

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
    const bikeId = generateId();

    await query(
      `INSERT INTO "Bike" (
        id, "userId", model, brand, plate, "currentKm",
        "oilType", "frontTirePressure", "rearTirePressure", "photoUrl",
        "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
      [
        bikeId,
        req.userId,
        data.model,
        data.brand,
        data.plate,
        data.currentKm,
        data.oilType,
        data.frontTirePressure,
        data.rearTirePressure,
        data.photoUrl || null,
      ]
    );

    const bike = await queryOne<Bike>(
      'SELECT * FROM "Bike" WHERE id = $1',
      [bikeId]
    );

    res.status(201).json({ bike });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Buscar moto por ID
router.get('/:bikeId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const bikeId = Array.isArray(req.params.bikeId) ? req.params.bikeId[0] : req.params.bikeId;

    const bike = await queryOne<Bike & { maintenanceLogs: MaintenanceLog[]; user: Partial<User> }>(
      `SELECT 
        b.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', ml.id,
              'partName', ml."partName",
              'category', ml.category,
              'status', ml.status,
              'createdAt', ml."createdAt"
            ) ORDER BY ml."createdAt" DESC
          ) FILTER (WHERE ml.id IS NOT NULL),
          '[]'::json
        ) as "maintenanceLogs",
        json_build_object(
          'id', u.id,
          'name', u.name,
          'email', u.email
        ) as user
       FROM "Bike" b
       LEFT JOIN "MaintenanceLog" ml ON ml."bikeId" = b.id
       LEFT JOIN "User" u ON u.id = b."userId"
       WHERE b.id = $1
       GROUP BY b.id, u.id`,
      [bikeId]
    );

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

    const bikeId = Array.isArray(req.params.bikeId) ? req.params.bikeId[0] : req.params.bikeId;
    const data: CreateMaintenanceLogDto = req.body;

    // Verificar se a moto pertence ao usuário
    const bike = await queryOne<Bike>(
      'SELECT * FROM "Bike" WHERE id = $1',
      [bikeId]
    );

    if (!bike || bike.userId !== req.userId) {
      return res.status(403).json({ error: 'Moto não encontrada ou não pertence ao usuário' });
    }

    const logId = generateId();

    await query(
      `INSERT INTO "MaintenanceLog" (
        id, "bikeId", "userId", "partName", category, "lastChangeKm",
        "recommendedChangeKm", "currentKm", "wearPercentage", status,
        "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
      [
        logId,
        bikeId,
        req.userId,
        data.partName,
        data.category,
        data.lastChangeKm,
        data.recommendedChangeKm,
        data.currentKm,
        data.wearPercentage,
        data.status,
      ]
    );

    // Adicionar pontos de fidelidade (5 pontos por manutenção registrada)
    await query(
      'UPDATE "User" SET "loyaltyPoints" = "loyaltyPoints" + 5, "updatedAt" = NOW() WHERE id = $1',
      [req.userId]
    );

    const maintenanceLog = await queryOne<MaintenanceLog>(
      'SELECT * FROM "MaintenanceLog" WHERE id = $1',
      [logId]
    );

    res.status(201).json({ maintenanceLog });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Listar logs de manutenção
router.get('/:bikeId/maintenance', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const bikeId = Array.isArray(req.params.bikeId) ? req.params.bikeId[0] : req.params.bikeId;

    const logs = await query<MaintenanceLog>(
      `SELECT * FROM "MaintenanceLog" 
       WHERE "bikeId" = $1 
       ORDER BY "createdAt" DESC`,
      [bikeId]
    );

    res.json({ logs });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
