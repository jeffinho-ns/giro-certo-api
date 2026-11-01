import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { query, queryOne } from '../lib/db';
import { generateId } from '../utils/id';
import { calculateDistance } from '../utils/haversine';
import {
  EventRsvpHttpError,
  getEventRsvp,
  setEventRsvp,
} from '../services/event-rsvp.service';

const router = Router();

const getParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] || '' : value || '';

// GET /api/social/events — eventos da rede social (para mapa e lista)
router.get('/events', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100);
    const communityId = (req.query.communityId as string)?.trim() || null;

    const hasTable = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'SocialEvent') as exists`
    );
    if (!hasTable?.exists) {
      return res.json({ events: [] });
    }

    let sql = `SELECT e.*, u.name as "createdByName"
       FROM "SocialEvent" e
       LEFT JOIN "User" u ON u.id = e."createdByUserId"
       WHERE e."dateTime" >= NOW()`;
    const params: any[] = [limit];
    let paramIdx = 2;
    if (communityId) {
      sql += ` AND e."communityId" = $${paramIdx++}`;
      params.push(communityId);
    }
    sql += ` ORDER BY e."dateTime" ASC LIMIT $1`;
    const events = await query<any>(sql, params);

    res.json({ events });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/social/events/:eventId/rsvp — o meu RSVP + contagens
router.get('/events/:eventId/rsvp', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
    const eventId = getParam(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: 'eventId inválido' });
    const result = await getEventRsvp(req.userId, eventId);
    res.json(result);
  } catch (error: unknown) {
    if (error instanceof EventRsvpHttpError) {
      return res.status(error.status).json({ error: error.message });
    }
    const message = error instanceof Error ? error.message : 'Erro interno';
    res.status(400).json({ error: message });
  }
});

// PUT /api/social/events/:eventId/rsvp — gravar presença (só o próprio user)
router.put('/events/:eventId/rsvp', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
    const eventId = getParam(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: 'eventId inválido' });
    const result = await setEventRsvp(req.userId, eventId, req.body);
    res.json(result);
  } catch (error: unknown) {
    if (error instanceof EventRsvpHttpError) {
      return res.status(error.status).json({ error: error.message });
    }
    const message = error instanceof Error ? error.message : 'Erro interno';
    res.status(400).json({ error: message });
  }
});

// GET /api/social/points-of-interest — POI partilhados (mecânicos, postos, etc.)
router.get('/points-of-interest', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const lat = req.query.lat != null ? parseFloat(req.query.lat as string) : null;
    const lng = req.query.lng != null ? parseFloat(req.query.lng as string) : null;
    const radiusKm = req.query.radiusKm != null ? parseFloat(req.query.radiusKm as string) : 50;

    const hasTable = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'PointOfInterest') as exists`
    );
    if (!hasTable?.exists) {
      return res.json({ points: [] });
    }

    let rows = await query<any>('SELECT * FROM "PointOfInterest" ORDER BY "createdAt" DESC LIMIT 100', []);
    if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng)) {
      rows = rows.filter((p: any) => {
        const d = calculateDistance(lat, lng, p.lat, p.lng);
        return d <= radiusKm;
      });
    }

    res.json({ points: rows });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/social/map-nearby — pilotos/entregadores que autorizaram visibilidade no mapa
router.get('/map-nearby', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const lat = req.query.lat != null ? parseFloat(req.query.lat as string) : null;
    const lng = req.query.lng != null ? parseFloat(req.query.lng as string) : null;
    const deliveryOnly = req.query.deliveryOnly === 'true';

    const hasShowOnMap = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'User' AND column_name = 'showOnMap'
      ) as exists`
    );
    if (!hasShowOnMap?.exists) {
      return res.json({ users: [] });
    }

    let sql = `SELECT id, name, "photoUrl", "pilotProfile", "currentLat", "currentLng", "showAsDelivery"
       FROM "User"
       WHERE "showOnMap" = true AND "currentLat" IS NOT NULL AND "currentLng" IS NOT NULL`;
    const params: any[] = [];
    if (deliveryOnly) {
      sql += ` AND "pilotProfile" = 'TRABALHO'`;
    }
    sql += ` LIMIT 100`;
    const users = await query<any>(sql, params);

    if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng)) {
      const withDistance = users
        .map((u: any) => ({
          ...u,
          distance: calculateDistance(lat, lng, u.currentLat, u.currentLng),
        }))
        .filter((u: any) => u.distance <= 50)
        .sort((a: any, b: any) => a.distance - b.distance);
      return res.json({ users: withDistance });
    }

    res.json({ users });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/social/delivery-ranking — ranking de entregadores (para lojista ou geral)
router.get('/delivery-ranking', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 50);
    const partnerId = (req.query.partnerId as string)?.trim() || null;

    const sqlRanking = partnerId
      ? `SELECT u.id, u.name, u."photoUrl", u."pilotProfile",
            COUNT(do.id)::int as "deliveryCount",
            COALESCE(SUM(CASE WHEN do.status = 'completed' THEN 1 ELSE 0 END), 0)::int as "completedCount"
         FROM "User" u
         INNER JOIN "DeliveryOrder" do ON do."riderId" = u.id AND do."storeId" = $2
         WHERE u."pilotProfile" = 'TRABALHO'
         GROUP BY u.id
         ORDER BY "completedCount" DESC, "deliveryCount" DESC
         LIMIT $1`
      : `SELECT u.id, u.name, u."photoUrl", u."pilotProfile",
            COUNT(do.id)::int as "deliveryCount",
            COALESCE(SUM(CASE WHEN do.status = 'completed' THEN 1 ELSE 0 END), 0)::int as "completedCount"
         FROM "User" u
         LEFT JOIN "DeliveryOrder" do ON do."riderId" = u.id
         WHERE u."pilotProfile" = 'TRABALHO'
         GROUP BY u.id
         ORDER BY "completedCount" DESC, "deliveryCount" DESC
         LIMIT $1`;
    const rows = await query<any>(sqlRanking, partnerId ? [limit, partnerId] : [limit]);

    res.json({ ranking: rows });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
