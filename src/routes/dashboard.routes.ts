import { Router, Response } from 'express';
import { authenticateToken, AuthRequest, requireModerator } from '../middleware/auth';
import { query, queryOne } from '../lib/db';
import { DeliveryStatus, VehicleType } from '../types';
import { getOpsMetricValue, getOpsMetricsForDays } from '../utils/ops-metrics';
import { DashboardFinancialService } from '../services/dashboard-financial.service';

const router = Router();
const dashboardFinancialService = new DashboardFinancialService();

router.get('/delivery-sla', authenticateToken, requireModerator, async (req: AuthRequest, res: Response) => {
  try {
    const days = Number(req.query.days ?? 1);
    const windowDays = Number.isFinite(days) ? Math.max(1, Math.min(days, 30)) : 1;

    const [created, accepted, acceptTime, storeToClient, conflicts, geocodingFails, routeFails, socketFails, cancellationsByStage, raw] =
      await Promise.all([
        getOpsMetricValue('orders_created_total', windowDays),
        getOpsMetricValue('orders_accepted_total', windowDays),
        getOpsMetricValue('time_to_accept_seconds', windowDays),
        getOpsMetricValue('store_to_client_seconds', windowDays),
        getOpsMetricValue('acceptance_conflicts_total', windowDays),
        getOpsMetricValue('geocoding_failures_total', windowDays),
        getOpsMetricValue('route_failures_total', windowDays),
        getOpsMetricValue('socket_failures_total', windowDays),
        query<{ label: string; count: string }>(
          `SELECT label, COALESCE(SUM(count), 0)::text as count
           FROM "DeliveryOpsMetric"
           WHERE metric = 'orders_cancelled_total'
             AND period_date >= (CURRENT_DATE - ($1::int - 1))
           GROUP BY label`,
          [windowDays]
        ),
        getOpsMetricsForDays(windowDays),
      ]);

    const acceptanceRate = created.count > 0 ? accepted.count / created.count : 0;
    const avgTimeToAcceptSeconds = acceptTime.count > 0 ? acceptTime.sum / acceptTime.count : 0;
    const avgStoreToClientSeconds =
      storeToClient.count > 0 ? storeToClient.sum / storeToClient.count : 0;

    res.json({
      windowDays,
      acceptanceRate,
      totals: {
        ordersCreated: created.count,
        ordersAccepted: accepted.count,
        acceptanceConflicts: conflicts.count,
        geocodingFailures: geocodingFails.count,
        routeFailures: routeFails.count,
        socketFailures: socketFails.count,
      },
      averages: {
        timeToAcceptSeconds: avgTimeToAcceptSeconds,
        storeToClientSeconds: avgStoreToClientSeconds,
      },
      cancellationsByStage: cancellationsByStage.map((row) => ({
        stage: row.label || 'unknown',
        count: Number(row.count),
      })),
      raw,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/** Relatório financeiro: cobranças entrega, carteira, repasses e assinaturas. */
router.get('/financial', authenticateToken, requireModerator, async (req: AuthRequest, res: Response) => {
  try {
    const days = Number(req.query.days ?? 30);
    const report = await dashboardFinancialService.getReport(days);
    res.json(report);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Erro ao carregar financeiro' });
  }
});

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
        'SELECT COUNT(*) as count FROM "DeliveryOrder" WHERE status IN ($1, $2)',
        [DeliveryStatus.inTransit, DeliveryStatus.inProgress]
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
    const statusesCsv = req.query.statuses as string | undefined;
    const vehicleType = req.query.vehicleType as string | undefined;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (statusesCsv) {
      const parts = statusesCsv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length > 0) {
        whereClause += ` AND "do".status::text = ANY($${paramIndex}::text[])`;
        params.push(parts);
        paramIndex++;
      }
    } else if (status) {
      whereClause += ` AND "do".status::text = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    // Construir JOINs condicionais
    let userJoinClause = 'LEFT JOIN "User" u ON u.id = "do"."riderId"';
    let bikeJoinClause = 'LEFT JOIN "Bike" b ON b."userId" = u.id';
    
    if (vehicleType) {
      // Se filtrar por tipo de veículo, precisa garantir que o rider tenha bike desse tipo
      userJoinClause = 'INNER JOIN "User" u ON u.id = "do"."riderId"';
      bikeJoinClause = `INNER JOIN "Bike" b ON b."userId" = u.id AND b."vehicleType" = $${paramIndex}`;
      params.push(vehicleType);
      paramIndex++;
    }

    const orders = await query(
      `SELECT 
        "do".*, 
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
       FROM "DeliveryOrder" "do"
       LEFT JOIN "Partner" p ON p.id = "do"."storeId"
       ${userJoinClause}
       ${bikeJoinClause}
       ${whereClause}
       ORDER BY "do"."createdAt" DESC
       LIMIT $${paramIndex}`,
      [...params, limit]
    );

    res.json({ orders });
  } catch (error: any) {
    console.error('Error in /dashboard/orders:', error);
    console.error('Error stack:', error.stack);
    console.error('Query params:', { 
      limit: req.query.limit, 
      status: req.query.status, 
      vehicleType: req.query.vehicleType 
    });
    res.status(400).json({ error: error.message || 'Erro ao buscar pedidos' });
  }
});

// Listar entregadores ativos com informações de veículo
router.get('/active-riders', authenticateToken, requireModerator, async (req: AuthRequest, res: Response) => {
  try {
    const vehicleType = req.query.vehicleType as string | undefined;
    const hasVerifiedBadge = req.query.hasVerifiedBadge === 'true' ? true : req.query.hasVerifiedBadge === 'false' ? false : undefined;
    const deliveryOnly =
      req.query.deliveryOnly === 'true' || req.query.deliveryOnly === '1';
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

    if (deliveryOnly) {
      whereClause += ` AND u."partnerId" IS NULL
        AND COALESCE(u."deliveryRiderBlocked", false) = false
        AND (
          EXISTS (SELECT 1 FROM "DeliveryRegistration" dr WHERE dr."userId" = u.id)
          OR u."pilotProfile" = 'TRABALHO'
        )`;
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
            SELECT AVG(r2.rating::numeric)
            FROM "Rating" r2
            WHERE r2."userId" = u.id AND r2."deliveryOrderId" IS NOT NULL
          ),
          0
        )::numeric as "averageRating",
        COUNT(DISTINCT CASE WHEN "do".status IN ('accepted', 'arrivedAtStore', 'inTransit', 'inProgress') THEN "do".id END) as "activeOrders",
        (
          SELECT do2.status
          FROM "DeliveryOrder" do2
          WHERE do2."riderId" = u.id
            AND do2.status IN ('accepted', 'arrivedAtStore', 'inTransit', 'inProgress')
          ORDER BY COALESCE(do2."acceptedAt", do2."createdAt") DESC
          LIMIT 1
        ) as "currentOrderStatus",
        (
          SELECT json_build_object(
            'id', do3.id,
            'status', do3.status,
            'storeName', do3."storeName",
            'storeAddress', do3."storeAddress",
            'deliveryAddress', do3."deliveryAddress",
            'storeLatitude', do3."storeLatitude",
            'storeLongitude', do3."storeLongitude",
            'deliveryLatitude', do3."deliveryLatitude",
            'deliveryLongitude', do3."deliveryLongitude"
          )
          FROM "DeliveryOrder" do3
          WHERE do3."riderId" = u.id
            AND do3.status IN ('accepted', 'arrivedAtStore', 'inTransit', 'inProgress')
          ORDER BY COALESCE(do3."acceptedAt", do3."createdAt") DESC
          LIMIT 1
        ) as "currentOrder"
       FROM "User" u
       ${bikeJoinClause}
       LEFT JOIN "DeliveryOrder" "do" ON "do"."riderId" = u.id AND "do".status IN ('accepted', 'arrivedAtStore', 'inTransit', 'inProgress')
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
