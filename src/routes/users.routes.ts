import { Router, Request, Response } from 'express';
import { query, queryOne } from '../lib/db';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth';
import { UpdateUserLocationDto, User, Bike, Wallet, UserRole } from '../types';

const router = Router();

// Buscar todos os usuários (admin/moderator)
router.get('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const users = await query<User>(
      `SELECT id, name, email, age, "photoUrl", "pilotProfile", role,
              "isSubscriber", "subscriptionType", "loyaltyPoints",
              "currentLat", "currentLng", "isOnline", "createdAt"
       FROM "User"
       ORDER BY "createdAt" DESC`
    );
    res.json({ users });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Buscar usuário por ID
router.get('/:userId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    
    const user = await queryOne<User & { bikes: Bike[]; wallet: Wallet & { transactions: any[] } }>(
      `SELECT 
        u.*,
        COALESCE(
          json_agg(DISTINCT jsonb_build_object(
            'id', b.id,
            'model', b.model,
            'brand', b.brand,
            'plate', b.plate
          )) FILTER (WHERE b.id IS NOT NULL),
          '[]'::json
        ) as bikes,
        json_build_object(
          'id', w.id,
          'userId', w."userId",
          'balance', w.balance,
          'totalEarned', w."totalEarned",
          'totalWithdrawn', w."totalWithdrawn",
          'transactions', COALESCE(
            (SELECT json_agg(t.* ORDER BY t."createdAt" DESC) 
             FROM "WalletTransaction" t 
             WHERE t."walletId" = w.id 
             LIMIT 10),
            '[]'::json
          )
        ) as wallet
       FROM "User" u
       LEFT JOIN "Bike" b ON b."userId" = u.id
       LEFT JOIN "Wallet" w ON w."userId" = u.id
       WHERE u.id = $1
       GROUP BY u.id, w.id`,
      [userId]
    );

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

    const user = await queryOne<User & { bikes: Bike[]; wallet: Wallet }>(
      `SELECT 
        u.*,
        COALESCE(
          json_agg(DISTINCT jsonb_build_object(
            'id', b.id,
            'model', b.model,
            'brand', b.brand,
            'plate', b.plate,
            'currentKm', b."currentKm"
          )) FILTER (WHERE b.id IS NOT NULL),
          '[]'::json
        ) as bikes,
        json_build_object(
          'id', w.id,
          'balance', w.balance,
          'totalEarned', w."totalEarned",
          'totalWithdrawn', w."totalWithdrawn"
        ) as wallet
       FROM "User" u
       LEFT JOIN "Bike" b ON b."userId" = u.id
       LEFT JOIN "Wallet" w ON w."userId" = u.id
       WHERE u.id = $1
       GROUP BY u.id, w.id`,
      [req.userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const { password, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Atualizar localização do usuário
router.put('/me/location', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const data: UpdateUserLocationDto = req.body;

    await query(
      `UPDATE "User" 
       SET "currentLat" = $1, "currentLng" = $2, 
           "lastLocationUpdate" = NOW(),
           "isOnline" = COALESCE($3, "isOnline"),
           "updatedAt" = NOW()
       WHERE id = $4`,
      [data.latitude, data.longitude, data.isOnline ?? true, req.userId]
    );

    res.json({ message: 'Localização atualizada com sucesso' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Estatísticas do usuário
router.get('/me/stats', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const stats = await queryOne<{
      totalDeliveries: number;
      completedDeliveries: number;
      totalEarned: number;
      averageRating: number;
    }>(
      `SELECT 
        COUNT(DISTINCT do.id) as "totalDeliveries",
        COUNT(DISTINCT CASE WHEN do.status = 'completed' THEN do.id END) as "completedDeliveries",
        COALESCE(w."totalEarned", 0) as "totalEarned",
        COALESCE(AVG(r.rating), 0) as "averageRating"
       FROM "User" u
       LEFT JOIN "DeliveryOrder" do ON do."riderId" = u.id
       LEFT JOIN "Wallet" w ON w."userId" = u.id
       LEFT JOIN "Rating" r ON r."userId" = u.id AND r."deliveryOrderId" IS NOT NULL
       WHERE u.id = $1
       GROUP BY w."totalEarned"`,
      [req.userId]
    );

    res.json({ stats });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Atualizar role do usuário (apenas admin)
router.put('/:userId/role', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    const { role } = req.body;

    if (!role || !Object.values(UserRole).includes(role)) {
      return res.status(400).json({ error: 'Role inválido' });
    }

    // Não permitir que um admin remova seu próprio acesso de admin
    if (req.userId === userId && role !== UserRole.ADMIN) {
      return res.status(400).json({ error: 'Você não pode remover seu próprio acesso de administrador' });
    }

    await query(
      `UPDATE "User" SET role = $1, "updatedAt" = NOW() WHERE id = $2`,
      [role, userId]
    );

    const updatedUser = await queryOne<User>(
      `SELECT id, name, email, role FROM "User" WHERE id = $1`,
      [userId]
    );

    res.json({ message: 'Role atualizado com sucesso', user: updatedUser });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
