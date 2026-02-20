import { Router, Request, Response } from 'express';
import multer from 'multer';
import { query, queryOne, transaction } from '../lib/db';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth';
import { UpdateUserLocationDto, User, Bike, Wallet, UserRole, UserType, PilotProfile } from '../types';
import { ImageService } from '../services/image.service';
import { ImageEntityType } from '../types';
import { generateId } from '../utils/id';

const router = Router();
const imageService = new ImageService();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Apenas imagens são permitidas'));
  },
});

const USER_TYPE_SQL = `
  CASE
    WHEN u."partnerId" IS NOT NULL THEN 'LOJISTA'
    WHEN u."pilotProfile" = 'FIM_DE_SEMANA' THEN 'CASUAL'
    WHEN u."pilotProfile" = 'URBANO' THEN 'DIARIO'
    WHEN u."pilotProfile" = 'PISTA' THEN 'RACING'
    WHEN u."pilotProfile" = 'TRABALHO' THEN 'DELIVERY'
    ELSE NULL
  END
`;

const USER_TYPE_TO_PILOT_PROFILE: Record<UserType, PilotProfile | null> = {
  [UserType.CASUAL]: PilotProfile.FIM_DE_SEMANA,
  [UserType.DIARIO]: PilotProfile.URBANO,
  [UserType.RACING]: PilotProfile.PISTA,
  [UserType.DELIVERY]: PilotProfile.TRABALHO,
  [UserType.LOJISTA]: null,
};

const getParam = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) {
    return value[0] || '';
  }
  return value || '';
};

const parseUserType = (value: unknown): UserType | null => {
  if (typeof value !== 'string') {
    return null;
  }
  if (!Object.values(UserType).includes(value as UserType)) {
    return null;
  }
  return value as UserType;
};

// Buscar todos os usuários (admin/moderator)
router.get('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const users = await query<User>(
      `SELECT
         u.id, u.name, u.email, u.age, u."photoUrl", u."pilotProfile", u.role, u."partnerId",
         u."isSubscriber", u."subscriptionType", u."loyaltyPoints",
         u."currentLat", u."currentLng", u."isOnline", u."createdAt", u."updatedAt",
         ${USER_TYPE_SQL} as "userType"
       FROM "User" u
       ORDER BY u."createdAt" DESC`
    );
    res.json({ users });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Buscar utilizadores por nome (rede social - ex: @jeff) — deve vir antes de /:userId
router.get('/search', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const q = (req.query.q as string)?.trim()?.replace(/^@/, '') || '';
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 50);

    if (q.length < 2) {
      return res.json({ users: [] });
    }

    const users = await query<User>(
      `SELECT id, name, email, age, "photoUrl", "pilotProfile", "createdAt"
       FROM "User"
       WHERE (LOWER(name) LIKE $1 OR LOWER(email) LIKE $1)
         AND id != $2
       ORDER BY name
       LIMIT $3`,
      [`%${q.toLowerCase()}%`, req.userId || '', limit]
    );

    const safeUsers = users.map((u) => {
      const { password, ...rest } = u as any;
      return rest;
    });

    res.json({ users: safeUsers });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Buscar usuário por ID
router.get('/:userId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = getParam(req.params.userId);
    
    const user = await queryOne<User & { bikes: Bike[]; wallet: Wallet & { transactions: any[] } }>(
      `SELECT 
        u.*,
        ${USER_TYPE_SQL} as "userType",
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

    const { password, ...userWithoutPassword } = user as any;
    res.json({ user: userWithoutPassword });
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
        ${USER_TYPE_SQL} as "userType",
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

    const { password, ...userWithoutPassword } = user as any;
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

// Atualizar perfil (nome, photoUrl)
router.patch('/me/profile', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const { name, photoUrl } = req.body as { name?: string; photoUrl?: string; coverUrl?: string };
    const updates: string[] = [];
    const values: any[] = [];
    let pos = 1;

    if (typeof name === 'string' && name.trim()) {
      updates.push(`name = $${pos++}`);
      values.push(name.trim());
    }
    if (typeof photoUrl === 'string') {
      updates.push(`"photoUrl" = $${pos++}`);
      values.push(photoUrl || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo válido para atualizar' });
    }

    updates.push('"updatedAt" = NOW()');
    values.push(req.userId);

    await query(
      `UPDATE "User" SET ${updates.join(', ')} WHERE id = $${pos}`,
      values
    );

    const user = await queryOne<User>(
      `SELECT id, name, email, age, "photoUrl", "pilotProfile", role, "partnerId",
        "isSubscriber", "hasVerifiedDocuments", "verificationBadge", "isOnline",
        "currentLat", "currentLng", "createdAt", "updatedAt"
       FROM "User" WHERE id = $1`,
      [req.userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const { password, ...userWithoutPassword } = user as any;
    res.json({ user: userWithoutPassword });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Upload de imagem de perfil (avatar ou capa)
router.post(
  '/me/upload-image',
  authenticateToken,
  upload.single('image'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Não autenticado' });
      }

      const file = (req as any).file;
      if (!file) {
        return res.status(400).json({ error: 'Nenhuma imagem fornecida' });
      }

      const type = (req.body?.type as string) || 'avatar';
      const image = await imageService.uploadImage(
        ImageEntityType.USER,
        req.userId,
        file,
        true
      );

      const baseUrl = process.env.API_URL || 'https://giro-certo-api.onrender.com';
      const imageUrl = `${baseUrl}/api/images/${image.id}`;

      await query(
        `UPDATE "User" SET "photoUrl" = $1, "updatedAt" = NOW() WHERE id = $2`,
        [imageUrl, req.userId]
      );

      res.status(201).json({ url: imageUrl, imageUrl });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

const handleUpdateUserType = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getParam(req.params.userId);
    const requestedUserType = parseUserType(req.body?.userType ?? req.body?.type);

    if (!requestedUserType) {
      return res.status(400).json({
        error: 'Tipo de usuário inválido. Use: CASUAL, DIARIO, RACING, DELIVERY ou LOJISTA',
      });
    }

    const user = await queryOne<User>(
      `SELECT id, name, email, role, "pilotProfile", "partnerId"
       FROM "User"
       WHERE id = $1`,
      [userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    if (requestedUserType === UserType.LOJISTA) {
      const bodyPartnerId = typeof req.body?.partnerId === 'string' ? req.body.partnerId : null;
      const partnerId = bodyPartnerId || user.partnerId;

      if (!partnerId) {
        return res.status(400).json({
          error:
            'Para definir o tipo LOJISTA o usuário precisa estar vinculado a uma loja (partnerId).',
        });
      }

      if (bodyPartnerId) {
        const partner = await queryOne<{ id: string }>(
          'SELECT id FROM "Partner" WHERE id = $1',
          [bodyPartnerId]
        );

        if (!partner) {
          return res.status(404).json({ error: 'Parceiro não encontrado para o partnerId informado' });
        }
      }

      await query(
        `UPDATE "User"
         SET "partnerId" = $1, "updatedAt" = NOW()
         WHERE id = $2`,
        [partnerId, userId]
      );
    } else {
      const pilotProfile = USER_TYPE_TO_PILOT_PROFILE[requestedUserType];

      if (!pilotProfile) {
        return res.status(400).json({ error: 'Tipo de usuário inválido para perfil de motociclista' });
      }

      await query(
        `UPDATE "User"
         SET "pilotProfile" = $1, "partnerId" = NULL, "updatedAt" = NOW()
         WHERE id = $2`,
        [pilotProfile, userId]
      );
    }

    const updatedUser = await queryOne<User>(
      `SELECT
         u.id, u.name, u.email, u.role, u."pilotProfile", u."partnerId", u."updatedAt",
         ${USER_TYPE_SQL} as "userType"
       FROM "User" u
       WHERE u.id = $1`,
      [userId]
    );

    res.json({ message: 'Tipo de usuário atualizado com sucesso', user: updatedUser });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

// Atualizar tipo de usuário (apenas admin)
router.put('/:userId/type', authenticateToken, requireAdmin, handleUpdateUserType);
router.put('/:userId/user-type', authenticateToken, requireAdmin, handleUpdateUserType);

// Atualizar role do usuário (apenas admin)
router.put('/:userId/role', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const userId = getParam(req.params.userId);
    const { role } = req.body;

    if (!role || !Object.values(UserRole).includes(role)) {
      return res.status(400).json({ error: 'Role inválido' });
    }

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

// Excluir usuário (apenas admin)
router.delete('/:userId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const userId = getParam(req.params.userId);

    if (!userId) {
      return res.status(400).json({ error: 'ID do usuário é obrigatório' });
    }

    if (req.userId === userId) {
      return res.status(400).json({ error: 'Você não pode excluir sua própria conta de administrador' });
    }

    const user = await queryOne<Pick<User, 'id' | 'name' | 'email' | 'role'>>(
      `SELECT id, name, email, role
       FROM "User"
       WHERE id = $1`,
      [userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    await transaction(async (client: any) => {
      await client.query(
        `UPDATE "DeliveryOrder"
         SET "riderId" = NULL, "riderName" = NULL
         WHERE "riderId" = $1`,
        [userId]
      );

      const deliveryRegistrationTable = await client.query(
        `SELECT to_regclass('"DeliveryRegistration"') as "tableName"`
      );
      const deliveryRegistrationTableName = deliveryRegistrationTable.rows[0]?.tableName;

      if (deliveryRegistrationTableName) {
        await client.query(
          `DELETE FROM "DeliveryRegistration"
           WHERE "userId" = $1`,
          [userId]
        );
      }

      await client.query(
        `DELETE FROM "User"
         WHERE id = $1`,
        [userId]
      );
    });

    res.json({ message: 'Usuário excluído com sucesso', user });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Seguir utilizador (rede social)
router.post('/:userId/follow', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const followerId = req.userId!;
    const followingId = getParam(req.params.userId);

    if (followerId === followingId) {
      return res.status(400).json({ error: 'Não pode seguir a si mesmo' });
    }

    const exists = await queryOne<{ id: string }>(
      'SELECT id FROM "User" WHERE id = $1',
      [followingId]
    );
    if (!exists) {
      return res.status(404).json({ error: 'Utilizador não encontrado' });
    }

    const followTable = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Follow') as exists`
    );
    if (!followTable?.exists) {
      return res.status(501).json({ error: 'Tabela Follow não existe. Execute a migração migrate-follow-social.sql' });
    }

    const id = generateId();
    await query(
      `INSERT INTO "Follow" (id, "followerId", "followingId") VALUES ($1, $2, $3)
       ON CONFLICT ("followerId", "followingId") DO NOTHING`,
      [id, followerId, followingId]
    );

    res.status(201).json({ message: 'A seguir', followed: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Deixar de seguir
router.delete('/:userId/follow', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const followerId = req.userId!;
    const followingId = getParam(req.params.userId);

    const followTable = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Follow') as exists`
    );
    if (!followTable?.exists) {
      return res.status(501).json({ error: 'Tabela Follow não existe. Execute a migração migrate-follow-social.sql' });
    }

    await query(
      `DELETE FROM "Follow" WHERE "followerId" = $1 AND "followingId" = $2`,
      [followerId, followingId]
    );

    res.json({ message: 'Deixou de seguir', followed: false });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Conceder/remover selo de verificação (apenas admin)
router.put('/:userId/verification-badge', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const userId = getParam(req.params.userId);
    const { verificationBadge } = req.body;

    if (typeof verificationBadge !== 'boolean') {
      return res.status(400).json({ error: 'verificationBadge deve ser um booleano' });
    }

    if (verificationBadge) {
      const user = await queryOne<User>(
        `SELECT "hasVerifiedDocuments" FROM "User" WHERE id = $1`,
        [userId]
      );

      if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado' });
      }

      if (!user.hasVerifiedDocuments) {
        return res.status(400).json({ 
          error: 'Não é possível conceder selo de verificação: usuário não possui documentos verificados' 
        });
      }
    }

    await query(
      `UPDATE "User" 
       SET "verificationBadge" = $1, "updatedAt" = NOW() 
       WHERE id = $2`,
      [verificationBadge, userId]
    );

    const updatedUser = await queryOne<User>(
      `SELECT id, name, email, "verificationBadge", "hasVerifiedDocuments" 
       FROM "User" WHERE id = $1`,
      [userId]
    );

    res.json({ 
      message: verificationBadge 
        ? 'Selo de verificação concedido com sucesso' 
        : 'Selo de verificação removido com sucesso',
      user: updatedUser 
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;