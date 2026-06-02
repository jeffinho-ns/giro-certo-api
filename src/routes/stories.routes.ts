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

    const stories = rows.map((r: any) => ({
      id: r.id,
      userId: r.userId,
      userName: r.userName,
      userAvatarUrl: r.userPhotoUrl,
      mediaUrl: r.mediaUrl,
      likeCount: r.likeCount ?? 0,
      createdAt: r.createdAt,
      caption: r.caption ?? null,
      template: r.template ?? 'NORMAL',
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

    const { mediaUrl, caption, template } = req.body as { mediaUrl?: string; caption?: string; template?: string };
    if (!mediaUrl || typeof mediaUrl !== 'string') {
      return res.status(400).json({ error: 'mediaUrl é obrigatório' });
    }
    const captionTrim = typeof caption === 'string' ? caption.trim() || null : null;
    const templateStr = (typeof template === 'string' && template.trim()) ? template.trim().toUpperCase() : 'NORMAL';
    const validTemplates = ['NORMAL', 'EM_ENTREGA', 'ROTA_DO_DIA'];
    const finalTemplate = validTemplates.includes(templateStr) ? templateStr : 'NORMAL';

    const storyId = generateId();
    const user = await queryOne<{ name: string; photoUrl: string | null }>(
      'SELECT name, "photoUrl" FROM "User" WHERE id = $1',
      [req.userId]
    );

    const hasTemplateCol = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Story' AND column_name = 'template') as exists`
    );
    if (hasTemplateCol?.exists) {
      await query(
        `INSERT INTO "Story" (id, "userId", "mediaUrl", "caption", "template", "likeCount", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 0, NOW(), NOW())`,
        [storyId, req.userId, mediaUrl.trim(), captionTrim, finalTemplate]
      );
    } else {
      await query(
        `INSERT INTO "Story" (id, "userId", "mediaUrl", "caption", "likeCount", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, 0, NOW(), NOW())`,
        [storyId, req.userId, mediaUrl.trim(), captionTrim]
      );
    }

    const story = {
      id: storyId,
      userId: req.userId,
      userName: user?.name ?? 'Utilizador',
      userAvatarUrl: user?.photoUrl ?? null,
      mediaUrl: mediaUrl.trim(),
      caption: captionTrim,
      template: finalTemplate,
      likeCount: 0,
      createdAt: new Date(),
    };

    res.status(201).json({ story });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Buscar story por ID (deep link)
router.get('/:storyId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const storyId = getParam(req.params.storyId);
    const row = await queryOne<Story & { userName: string; userPhotoUrl: string | null }>(
      `SELECT s.*, u.name as "userName", u."photoUrl" as "userPhotoUrl"
       FROM "Story" s
       JOIN "User" u ON u.id = s."userId"
       WHERE s.id = $1
       LIMIT 1`,
      [storyId]
    );
    if (!row) {
      return res.status(404).json({ error: 'Story não encontrada' });
    }
    const story = {
      id: row.id,
      userId: row.userId,
      userName: row.userName,
      userAvatarUrl: row.userPhotoUrl,
      mediaUrl: row.mediaUrl,
      likeCount: row.likeCount ?? 0,
      createdAt: row.createdAt,
      caption: (row as any).caption ?? null,
      template: (row as any).template ?? 'NORMAL',
    };
    return res.json({ story });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
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
