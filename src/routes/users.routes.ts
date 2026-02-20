import { Router, Request, Response } from 'express';
import multer from 'multer';
import { query, queryOne, transaction } from '../lib/db';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth';
import { UpdateUserLocationDto, User, Bike, Wallet, UserRole, UserType, PilotProfile } from '../types';
import { ImageService } from '../services/image.service';
import { AlertService, AlertType, AlertSeverity } from '../services/alert.service';
import { ImageEntityType } from '../types';
import { generateId } from '../utils/id';

const router = Router();
const imageService = new ImageService();
const alertService = new AlertService();

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
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);

    if (q.length < 1) {
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

    const { name, photoUrl, coverUrl } = req.body as { name?: string; photoUrl?: string; coverUrl?: string };
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
    if (typeof coverUrl === 'string') {
      updates.push(`"coverUrl" = $${pos++}`);
      values.push(coverUrl || null);
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
      `SELECT id, name, email, age, "photoUrl", "coverUrl", "pilotProfile", role, "partnerId",
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

      const type = ((req.body?.type as string) || 'avatar').toLowerCase();
      const image = await imageService.uploadImage(
        ImageEntityType.USER,
        req.userId,
        file,
        true
      );

      const baseUrl =
        process.env.API_URL ||
        (req.protocol && req.get('host')
          ? `${req.protocol}://${req.get('host')}`
          : 'https://giro-certo-api.onrender.com');
      const imageUrl = `${baseUrl}/api/images/${image.id}`;

      if (type === 'cover') {
        await query(
          `UPDATE "User" SET "coverUrl" = $1, "updatedAt" = NOW() WHERE id = $2`,
          [imageUrl, req.userId]
        );
      } else {
        await query(
          `UPDATE "User" SET "photoUrl" = $1, "updatedAt" = NOW() WHERE id = $2`,
          [imageUrl, req.userId]
        );
      }

      res.status(201).json({ url: imageUrl, imageUrl });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// Listar pedidos de seguimento recebidos (pendentes)
router.get('/me/follow-requests', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const targetId = req.userId!;
    const hasTable = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'FollowRequest') as exists`
    );
    if (!hasTable?.exists) {
      return res.json({ requests: [] });
    }

    const requests = await query<{
      id: string;
      requesterId: string;
      requesterName: string;
      requesterPhotoUrl: string | null;
      createdAt: Date;
    }>(
      `SELECT fr.id, fr."requesterId", u.name as "requesterName", u."photoUrl" as "requesterPhotoUrl", fr."createdAt"
       FROM "FollowRequest" fr
       JOIN "User" u ON u.id = fr."requesterId"
       WHERE fr."targetId" = $1 AND fr.status = 'pending'
       ORDER BY fr."createdAt" DESC`,
      [targetId]
    );

    res.json({ requests });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Listar pedidos de seguimento enviados por mim (para mostrar "Solicitação enviada")
router.get('/me/follow-requests/sent', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const requesterId = req.userId!;
    const hasTable = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'FollowRequest') as exists`
    );
    if (!hasTable?.exists) {
      return res.json({ targetIds: [] });
    }

    const rows = await query<{ targetId: string }>(
      `SELECT "targetId" FROM "FollowRequest" WHERE "requesterId" = $1 AND status = 'pending'`,
      [requesterId]
    );

    res.json({ targetIds: rows.map((r) => r.targetId) });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Aceitar pedido de seguimento (e opcionalmente seguir de volta)
router.post('/me/follow-requests/:requestId/accept', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const targetId = req.userId!;
    const requestId = getParam(req.params.requestId);
    const followBack = (req.body as { followBack?: boolean })?.followBack === true;

    const reqRow = await queryOne<{ id: string; requesterId: string; status: string }>(
      'SELECT id, "requesterId", status FROM "FollowRequest" WHERE id = $1 AND "targetId" = $2',
      [requestId, targetId]
    );
    if (!reqRow || reqRow.status !== 'pending') {
      return res.status(404).json({ error: 'Pedido não encontrado ou já respondido' });
    }

    const requesterId = reqRow.requesterId;
    const targetUser = await queryOne<{ name: string }>('SELECT name FROM "User" WHERE id = $1', [targetId]);

    await transaction(async (client: any) => {
      await client.query(
        `UPDATE "FollowRequest" SET status = 'accepted', "respondedAt" = NOW() WHERE id = $1`,
        [requestId]
      );
      const followExists = await queryOne<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Follow') as exists`
      );
      if (followExists?.exists) {
        await client.query(
          `INSERT INTO "Follow" (id, "followerId", "followingId") VALUES ($1, $2, $3) ON CONFLICT ("followerId", "followingId") DO NOTHING`,
          [generateId(), requesterId, targetId]
        );
        if (followBack) {
          await client.query(
            `INSERT INTO "Follow" (id, "followerId", "followingId") VALUES ($1, $2, $3) ON CONFLICT ("followerId", "followingId") DO NOTHING`,
            [generateId(), targetId, requesterId]
          );
        }
      }
    });

    await alertService.createAlert({
      type: AlertType.FOLLOW_REQUEST,
      severity: AlertSeverity.LOW,
      title: 'Pedido aceite',
      message: `${targetUser?.name || 'Alguém'} aceitou o teu pedido de seguimento${followBack ? ' e seguiu-te de volta' : ''}.`,
      userId: requesterId,
      metadata: { type: 'follow_request_accepted', targetId, followBack },
    });

    const io = (req as any).app?.get?.('io');
    if (io?.to) {
      io.to(`user:${requesterId}`).emit('notification', { type: 'follow_request_accepted', targetName: targetUser?.name });
    }

    res.json({ message: 'Pedido aceite', followBack });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Rejeitar pedido de seguimento
router.post('/me/follow-requests/:requestId/reject', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const targetId = req.userId!;
    const requestId = getParam(req.params.requestId);

    const reqRow = await queryOne<{ id: string; status: string }>(
      'SELECT id, status FROM "FollowRequest" WHERE id = $1 AND "targetId" = $2',
      [requestId, targetId]
    );
    if (!reqRow || reqRow.status !== 'pending') {
      return res.status(404).json({ error: 'Pedido não encontrado ou já respondido' });
    }

    await query(
      `UPDATE "FollowRequest" SET status = 'rejected', "respondedAt" = NOW() WHERE id = $1`,
      [requestId]
    );

    res.json({ message: 'Pedido rejeitado' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

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

// Enviar pedido de seguimento (rede social)
router.post('/:userId/follow-request', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const requesterId = req.userId!;
    const targetId = getParam(req.params.userId);

    if (requesterId === targetId) {
      return res.status(400).json({ error: 'Não pode enviar pedido a si mesmo' });
    }

    const targetUser = await queryOne<{ id: string; name: string }>(
      'SELECT id, name FROM "User" WHERE id = $1',
      [targetId]
    );
    if (!targetUser) {
      return res.status(404).json({ error: 'Utilizador não encontrado' });
    }

    const hasTable = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'FollowRequest') as exists`
    );
    if (!hasTable?.exists) {
      return res.status(501).json({ error: 'Tabela FollowRequest não existe. Execute a migração migrate-follow-requests.sql' });
    }

    const requester = await queryOne<{ name: string }>('SELECT name FROM "User" WHERE id = $1', [requesterId]);
    const requestId = generateId();

    const inserted = await query<{ id: string }>(
      `INSERT INTO "FollowRequest" (id, "requesterId", "targetId", status) VALUES ($1, $2, $3, 'pending')
       ON CONFLICT ("requesterId", "targetId") DO UPDATE SET status = 'pending', "respondedAt" = NULL
       RETURNING id`,
      [requestId, requesterId, targetId]
    );
    const finalRequestId = inserted?.[0]?.id || requestId;

    const alert = await alertService.createAlert({
      type: AlertType.FOLLOW_REQUEST,
      severity: AlertSeverity.MEDIUM,
      title: 'Pedido de seguimento',
      message: `${requester?.name || 'Alguém'} quer seguir-te.`,
      userId: targetId,
      metadata: { followRequestId: finalRequestId, requesterId, requesterName: requester?.name },
    });

    const io = (req as any).app?.get?.('io');
    if (io?.to) {
      io.to(`user:${targetId}`).emit('notification', alert);
    }

    res.status(201).json({ message: 'Pedido enviado', requestId: finalRequestId });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Seguir utilizador (rede social) — direto (ex.: após aceitar pedido)
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