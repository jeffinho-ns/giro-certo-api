import { Router, Response } from 'express';
import { authenticateToken, AuthRequest, requireModerator } from '../middleware/auth';
import { query, queryOne } from '../lib/db';
import { DeliveryStatus, VehicleType } from '../types';

const router = Router();

// Dashboard stats com filtros
router.get('/stats', authenticateToken, requireModerator, async (req: AuthRequest, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Filtros opcionais
    const vehicleType = req.query.vehicleType as string | undefined;
    const hasVerifiedBadge = req.query.hasVerifiedBadge === 'true' ? true : req.query.hasVerifiedBadge === 'false' ? false : undefined;

    // Construir WHERE clause para entregadores ativos
    let ridersWhere = 'WHERE u."isOnline" = true';
    const ridersParams: any[] = [];
    let paramIndex = 1;

    if (vehicleType) {
      ridersWhere += ` AND b."vehicleType" = $${paramIndex}`;
      ridersParams.push(vehicleType);
      paramIndex++;
    }

    if (hasVerifiedBadge !== undefined) {
      ridersWhere += ` AND u."verificationBadge" = $${paramIndex}`;
      ridersParams.push(hasVerifiedBadge);
      paramIndex++;
    }

    // Query para entregadores ativos (com JOIN em Bike se necessário)
    let activeRidersQuery = '';
    if (vehicleType) {
      activeRidersQuery = `
        SELECT COUNT(DISTINCT u.id) as count 
        FROM "User" u
        INNER JOIN "Bike" b ON b."userId" = u.id
        ${ridersWhere}
      `;
    } else {
      activeRidersQuery = `
        SELECT COUNT(*) as count 
        FROM "User" u
        ${ridersWhere}
      `;
    }

    const [
      activeRiders,
      activeRidersByType,
      todaysOrders,
      inProgressOrders,
      pendingOrders,
      completedOrders,
      premiumSubscribers,
      totalRevenue,
      verifiedRiders,
    ] = await Promise.all([
      queryOne<{ count: string }>(activeRidersQuery, ridersParams),
      // Estatísticas por tipo de veículo
      queryOne<{ motorcycles: string; bicycles: string }>(
        `SELECT 
          COUNT(DISTINCT CASE WHEN b."vehicleType" = 'MOTORCYCLE' THEN u.id END) as motorcycles,
          COUNT(DISTINCT CASE WHEN b."vehicleType" = 'BICYCLE' THEN u.id END) as bicycles
         FROM "User" u
         INNER JOIN "Bike" b ON b."userId" = u.id
         WHERE u."isOnline" = true`
      ),
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
        'SELECT COUNT(*) as count FROM "DeliveryOrder" WHERE status = $1 AND "createdAt" >= $2',
        [DeliveryStatus.completed, today]
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
      queryOne<{ count: string }>(
        'SELECT COUNT(*) as count FROM "User" WHERE "verificationBadge" = true AND "isOnline" = true'
      ),
    ]);

    res.json({
      activeRiders: parseInt(activeRiders?.count || '0'),
      activeRidersByType: {
        motorcycles: parseInt(activeRidersByType?.motorcycles || '0'),
        bicycles: parseInt(activeRidersByType?.bicycles || '0'),
      },
      todaysOrders: parseInt(todaysOrders?.count || '0'),
      inProgressOrders: parseInt(inProgressOrders?.count || '0'),
      pendingOrders: parseInt(pendingOrders?.count || '0'),
      completedOrders: parseInt(completedOrders?.count || '0'),
      premiumSubscribers: parseInt(premiumSubscribers?.count || '0'),
      totalRevenue: parseFloat(totalRevenue?.sum || '0'),
      verifiedRiders: parseInt(verifiedRiders?.count || '0'),
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Listar pedidos recentes com filtros
router.get('/orders', authenticateToken, requireModerator, async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string | undefined;
    const vehicleType = req.query.vehicleType as string | undefined;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (status) {
      whereClause += ` AND do.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    // Construir JOINs condicionais
    let userJoinClause = 'LEFT JOIN "User" u ON u.id = do."riderId"';
    let bikeJoinClause = 'LEFT JOIN "Bike" b ON b."userId" = u.id';
    
    if (vehicleType) {
      // Se filtrar por tipo de veículo, precisa garantir que o rider tenha bike desse tipo
      userJoinClause = 'INNER JOIN "User" u ON u.id = do."riderId"';
      bikeJoinClause = `INNER JOIN "Bike" b ON b."userId" = u.id AND b."vehicleType" = $${paramIndex}`;
      params.push(vehicleType);
      paramIndex++;
    }

    const orders = await query(
      `SELECT 
        do.*, 
        json_build_object('id', p.id, 'name', p.name) as partner,
        CASE 
          WHEN u.id IS NOT NULL THEN json_build_object(
            'id', u.id, 
            'name', u.name,
            'email', u.email,
            'verificationBadge', u."verificationBadge"
          )
          ELSE NULL
        END as rider,
        CASE 
          WHEN b.id IS NOT NULL THEN json_build_object(
            'id', b.id,
            'vehicleType', b."vehicleType",
            'model', b.model,
            'brand', b.brand
          )
          ELSE NULL
        END as bike
       FROM "DeliveryOrder" do
       LEFT JOIN "Partner" p ON p.id = do."storeId"
       ${userJoinClause}
       ${bikeJoinClause}
       ${whereClause}
       ORDER BY do."createdAt" DESC
       LIMIT $${paramIndex}`,
      [...params, limit]
    );

    res.json({ orders });
  } catch (error: any) {
    console.error('Error in /dashboard/orders:', error);
    console.error('Error stack:', error.stack);
    console.error('Query params:', { limit, status, vehicleType });
    res.status(400).json({ error: error.message || 'Erro ao buscar pedidos' });
  }
});

// Listar entregadores ativos com informações de veículo
router.get('/active-riders', authenticateToken, requireModerator, async (req: AuthRequest, res: Response) => {
  try {
    const vehicleType = req.query.vehicleType as string | undefined;
    const hasVerifiedBadge = req.query.hasVerifiedBadge === 'true' ? true : req.query.hasVerifiedBadge === 'false' ? false : undefined;
    const radius = req.query.radius ? parseFloat(req.query.radius as string) : undefined;
    const centerLat = req.query.centerLat ? parseFloat(req.query.centerLat as string) : undefined;
    const centerLng = req.query.centerLng ? parseFloat(req.query.centerLng as string) : undefined;

    let whereClause = 'WHERE u."isOnline" = true AND u."currentLat" IS NOT NULL AND u."currentLng" IS NOT NULL';
    const params: any[] = [];
    let paramIndex = 1;

    // Se filtrar por tipo de veículo, precisa garantir que o usuário tenha bike
    let bikeJoinClause = '';
    if (vehicleType) {
      bikeJoinClause = `INNER JOIN "Bike" b ON b."userId" = u.id AND b."vehicleType" = $${paramIndex}`;
      params.push(vehicleType);
      paramIndex++;
    }

    if (hasVerifiedBadge !== undefined) {
      whereClause += ` AND u."verificationBadge" = $${paramIndex}`;
      params.push(hasVerifiedBadge);
      paramIndex++;
    }

    const riders = await query(
      `SELECT 
        u.id,
        u.name,
        u.email,
        u."currentLat" as lat,
        u."currentLng" as lng,
        u."isOnline",
        u."verificationBadge" as "hasVerifiedBadge",
        u."isSubscriber",
        u."subscriptionType",
        COALESCE(
          (
            SELECT json_build_object(
              'id', b2.id,
              'vehicleType', b2."vehicleType",
              'model', b2.model,
              'brand', b2.brand,
              'plate', b2.plate
            )
            FROM "Bike" b2
            WHERE b2."userId" = u.id
            ORDER BY b2."createdAt" DESC
            LIMIT 1
          ),
          'null'::json
        ) as bike,
        COALESCE(
          (
            SELECT AVG(r2.rating)
            FROM "Rating" r2
            WHERE r2."userId" = u.id AND r2."deliveryOrderId" IS NOT NULL
          ),
          0
        ) as "averageRating",
        COUNT(DISTINCT CASE WHEN do.status IN ('accepted', 'inProgress') THEN do.id END) as "activeOrders"
       FROM "User" u
       ${bikeJoinClause ? bikeJoinClause + ' ' : ''}
       LEFT JOIN "DeliveryOrder" do ON do."riderId" = u.id AND do.status IN ('accepted', 'inProgress')
       ${whereClause}
       GROUP BY u.id
       ORDER BY u."verificationBadge" DESC, u."isSubscriber" DESC, u."createdAt" DESC`,
      params
    );

    // Filtrar por raio se fornecido
    let filteredRiders = riders;
    if (radius && centerLat && centerLng) {
      const { calculateDistance } = require('../utils/haversine');
      filteredRiders = riders.filter((rider: any) => {
        if (!rider.lat || !rider.lng) return false;
        const distance = calculateDistance(centerLat, centerLng, rider.lat, rider.lng);
        return distance <= radius;
      });
    }

    res.json({ riders: filteredRiders });
  } catch (error: any) {
    console.error('Error in /dashboard/active-riders:', error);
    console.error('Error stack:', error.stack);
    res.status(400).json({ error: error.message || 'Erro ao buscar entregadores ativos' });
  }
});

export default router;
