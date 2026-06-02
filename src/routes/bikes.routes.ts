import { Router, Response } from 'express';
import { authenticateToken, AuthRequest, requireModerator } from '../middleware/auth';
import { query, queryOne } from '../lib/db';
import { CreateBikeDto, CreateMaintenanceLogDto, Bike, MaintenanceLog, User, VehicleType } from '../types';
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
       GROUP BY b.id
       ORDER BY b."updatedAt" DESC, b."createdAt" DESC`,
      [req.userId]
    );

    res.json({ bikes });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Listar veículos de outro utilizador (admin / moderação) — com manutenção
router.get(
  '/admin/user/:userId',
  authenticateToken,
  requireModerator,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
      if (!userId) {
        return res.status(400).json({ error: 'userId inválido' });
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
        [userId]
      );
      return res.json({ bikes });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  }
);

// Criar veículo (moto ou bicicleta)
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const data: CreateBikeDto = req.body;
    const vehicleType = data.vehicleType || VehicleType.MOTORCYCLE; // Default para moto
    const bikeId = generateId();

    // Validações baseadas no tipo de veículo
    if (vehicleType === VehicleType.MOTORCYCLE) {
      if (!data.plate) {
        return res.status(400).json({ error: 'Placa é obrigatória para motos' });
      }
    }
    // Para bicicletas, plate é opcional

    await query(
      `INSERT INTO "Bike" (
        id, "userId", model, brand, "vehicleType", plate, "currentKm",
        "oilType", "frontTirePressure", "rearTirePressure", 
        "photoUrl", "vehiclePhotoUrl", "platePhotoUrl",
        nickname, "ridingStyle", accessories, "nextUpgrade", "preferredColor", "galleryUrls",
        "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW(), NOW())`,
      [
        bikeId,
        req.userId,
        data.model,
        data.brand,
        vehicleType,
        data.plate || null, // Nullable para bicicletas
        data.currentKm,
        data.oilType || null, // Opcional para bicicletas
        data.frontTirePressure || null, // Opcional para bicicletas
        data.rearTirePressure || null, // Opcional para bicicletas
        data.photoUrl || null,
        data.vehiclePhotoUrl || null,
        data.platePhotoUrl || null,
        data.nickname || null,
        data.ridingStyle || null,
        data.accessories || [],
        data.nextUpgrade || null,
        data.preferredColor || null,
        data.galleryUrls || [],
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

// Atualizar dados premium da garagem (inclui múltiplas fotos)
router.patch('/:bikeId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const bikeId = Array.isArray(req.params.bikeId) ? req.params.bikeId[0] : req.params.bikeId;
    const current = await queryOne<Bike>(
      'SELECT * FROM "Bike" WHERE id = $1',
      [bikeId]
    );
    if (!current || current.userId !== req.userId) {
      return res.status(403).json({ error: 'Moto não encontrada ou sem permissão' });
    }

    const data = req.body as Partial<CreateBikeDto>;
    const updates: string[] = [];
    const values: any[] = [];
    let pos = 1;

    const setNullableText = (column: string, value: unknown) => {
      if (value === undefined) return;
      updates.push(`${column} = $${pos}`);
      values.push(value === null || value === '' ? null : String(value));
      pos++;
    };

    const setNullableNumber = (column: string, value: unknown) => {
      if (value === undefined) return;
      const parsed = Number(value);
      updates.push(`${column} = $${pos}`);
      values.push(Number.isFinite(parsed) ? parsed : null);
      pos++;
    };

    setNullableText('model', data.model);
    setNullableText('brand', data.brand);
    setNullableText('plate', data.plate);
    setNullableNumber('"currentKm"', data.currentKm);
    setNullableText('"oilType"', data.oilType);
    setNullableNumber('"frontTirePressure"', data.frontTirePressure);
    setNullableNumber('"rearTirePressure"', data.rearTirePressure);
    setNullableText('"photoUrl"', data.photoUrl);
    setNullableText('"vehiclePhotoUrl"', data.vehiclePhotoUrl);
    setNullableText('"platePhotoUrl"', data.platePhotoUrl);
    setNullableText('nickname', data.nickname);
    setNullableText('"ridingStyle"', data.ridingStyle);
    setNullableText('"nextUpgrade"', data.nextUpgrade);
    setNullableText('"preferredColor"', data.preferredColor);

    if (data.accessories !== undefined) {
      updates.push(`accessories = $${pos}`);
      values.push(Array.isArray(data.accessories) ? data.accessories : []);
      pos++;
    }
    if (data.galleryUrls !== undefined) {
      updates.push(`"galleryUrls" = $${pos}`);
      values.push(Array.isArray(data.galleryUrls) ? data.galleryUrls : []);
      pos++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo válido para atualização' });
    }

    updates.push(`"updatedAt" = NOW()`);
    values.push(bikeId);

    await query(
      `UPDATE "Bike" SET ${updates.join(', ')} WHERE id = $${pos}`,
      values
    );

    const bike = await queryOne<Bike>('SELECT * FROM "Bike" WHERE id = $1', [bikeId]);
    res.json({ bike });
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
