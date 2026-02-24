import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { query, queryOne } from '../lib/db';
import { Story } from '../types';
import { generateId } from '../utils/id';

const router = Router();

const getParam = (v: string | string[] | undefined): string =>
  Array.isArray(v) ? v[0] || '' : v || '';

// Listar stories (todos ou por userId)
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = (req.query.userId as string)?.trim() || null;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    const hasTable = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Story') as exists`
    );
    if (!hasTable?.exists) {
      return res.json({ stories: [] });
    }

    // Stories expiram após 24 horas: só listar os das últimas 24h
    const whereClause = userId
      ? 'WHERE s."userId" = $2 AND s."createdAt" > NOW() - INTERVAL \'24 hours\''
      : 'WHERE s."createdAt" > NOW() - INTERVAL \'24 hours\'';
    const params = userId ? [limit, userId] : [limit];

    const rows = await query<Story & { userName: string; userPhotoUrl: string | null }>(
      `SELECT s.*, u.name as "userName", u."photoUrl" as "userPhotoUrl"
       FROM "Story" s
       JOIN "User" u ON u.id = s."userId"
       ${whereClause}
       ORDER BY s."createdAt" DESC
       LIMIT $1`,
      params
    );

    const stories = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: r.userName,
      userAvatarUrl: r.userPhotoUrl,
      mediaUrl: r.mediaUrl,
      likeCount: r.likeCount ?? 0,
      createdAt: r.createdAt,
    }));

    res.json({ stories });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Criar story
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });

    const hasTable = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Story') as exists`
    );
    if (!hasTable?.exists) {
      return res.status(501).json({ error: 'Tabela Story não existe. Execute migrate-stories.sql' });
    }

    const { mediaUrl } = req.body as { mediaUrl?: string };
    if (!mediaUrl || typeof mediaUrl !== 'string') {
      return res.status(400).json({ error: 'mediaUrl é obrigatório' });
    }

    const storyId = generateId();
    const user = await queryOne<{ name: string; photoUrl: string | null }>(
      'SELECT name, "photoUrl" FROM "User" WHERE id = $1',
      [req.userId]
    );

    await query(
      `INSERT INTO "Story" (id, "userId", "mediaUrl", "likeCount", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 0, NOW(), NOW())`,
      [storyId, req.userId, mediaUrl.trim()]
    );

    const story = {
      id: storyId,
      userId: req.userId,
      userName: user?.name ?? 'Utilizador',
      userAvatarUrl: user?.photoUrl ?? null,
      mediaUrl: mediaUrl.trim(),
      likeCount: 0,
      createdAt: new Date(),
    };

    res.status(201).json({ story });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Deletar story (apenas dono)
router.delete('/:storyId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const storyId = getParam(req.params.storyId);
    const story = await queryOne<{ userId: string }>(
      'SELECT "userId" FROM "Story" WHERE id = $1',
      [storyId]
    );
    if (!story) return res.status(404).json({ error: 'Story não encontrado' });
    if (story.userId !== req.userId) {
      return res.status(403).json({ error: 'Sem permissão para excluir este story' });
    }
    await query('DELETE FROM "Story" WHERE id = $1', [storyId]);
    res.json({ message: 'Story excluído' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
