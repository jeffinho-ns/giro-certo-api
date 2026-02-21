import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { UserRole } from '../types';
import { query, queryOne, transaction } from '../lib/db';
import { Post } from '../types';
import { generateId } from '../utils/id';

const router = Router();

// Listar posts da comunidade (opcional: filtrar por userId, ou apenas reportados para moderação)
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const userId = (req.query.userId as string)?.trim() || null;
    const reportedOnly = req.query.reported === 'true' || req.query.reported === '1';

    const conditions: string[] = [];
    const params: (number | string)[] = [limit, offset];
    let paramIdx = 3;
    if (userId) {
      conditions.push(`p."userId" = $${paramIdx++}`);
      params.push(userId);
    }
    let hasReportTable = false;
    if (reportedOnly) {
      const r = await queryOne<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'PostReport') as exists`
      );
      hasReportTable = r?.exists ?? false;
      if (hasReportTable) {
        conditions.push(`EXISTS (SELECT 1 FROM "PostReport" pr WHERE pr."postId" = p.id AND pr.status = 'pending')`);
      }
    }
    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const selectReportInfo = reportedOnly && hasReportTable ? `
        (SELECT json_agg(json_build_object('reason', pr.reason, 'createdAt', pr."createdAt"))
         FROM "PostReport" pr WHERE pr."postId" = p.id AND pr.status = 'pending') as "reportInfo",
        ` : '';

    const posts = await query<Post & { user: any; likes: any[]; comments: any[]; reportInfo?: any }>(
      `SELECT 
        p.*,
        ${selectReportInfo}
        json_build_object('id', u.id, 'name', u.name, 'photoUrl', u."photoUrl") as user,
        COALESCE(
          json_agg(DISTINCT jsonb_build_object('userId', pl."userId")) 
          FILTER (WHERE pl.id IS NOT NULL),
          '[]'::json
        ) as likes,
        COALESCE(
          json_agg(
            jsonb_build_object(
              'id', c.id,
              'content', c.content,
              'createdAt', c."createdAt",
              'user', json_build_object('id', cu.id, 'name', cu.name, 'photoUrl', cu."photoUrl")
            ) ORDER BY c."createdAt" DESC
          ) FILTER (WHERE c.id IS NOT NULL),
          '[]'::json
        ) as comments
       FROM "Post" p
       LEFT JOIN "User" u ON u.id = p."userId"
       LEFT JOIN "PostLike" pl ON pl."postId" = p.id
       LEFT JOIN "Comment" c ON c."postId" = p.id
       LEFT JOIN "User" cu ON cu.id = c."userId"
       ${whereClause}
       GROUP BY p.id, u.id
       ORDER BY p."createdAt" DESC
       LIMIT $1 OFFSET $2`,
      params
    );

    res.json({ posts });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Criar post
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const { content, images } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Conteúdo é obrigatório' });
    }

    const postId = generateId();

    await query(
      `INSERT INTO "Post" (id, "userId", content, images, "likesCount", "commentsCount", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 0, 0, NOW(), NOW())`,
      [postId, req.userId, content, JSON.stringify(images || [])]
    );

    const post = await queryOne<Post & { user: any }>(
      `SELECT p.*, json_build_object('id', u.id, 'name', u.name, 'photoUrl', u."photoUrl") as user
       FROM "Post" p
       LEFT JOIN "User" u ON u.id = p."userId"
       WHERE p.id = $1`,
      [postId]
    );

    res.status(201).json({ post });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Curtir post
router.post('/:postId/like', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const postId = Array.isArray(req.params.postId) ? req.params.postId[0] : req.params.postId;

    // Verificar se já curtiu
    const existingLike = await queryOne<{ id: string }>(
      'SELECT id FROM "PostLike" WHERE "postId" = $1 AND "userId" = $2',
      [postId, req.userId]
    );

    await transaction(async (client) => {
      if (existingLike) {
        // Remover like
        await client.query('DELETE FROM "PostLike" WHERE id = $1', [existingLike.id]);
        await client.query('UPDATE "Post" SET "likesCount" = "likesCount" - 1 WHERE id = $1', [postId]);
      } else {
        // Adicionar like
        const likeId = generateId();
        await client.query(
          'INSERT INTO "PostLike" (id, "postId", "userId", "createdAt") VALUES ($1, $2, $3, NOW())',
          [likeId, postId, req.userId]
        );
        await client.query('UPDATE "Post" SET "likesCount" = "likesCount" + 1 WHERE id = $1', [postId]);
      }
    });

    res.json({ liked: !existingLike });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Listar comentários de um post
router.get('/:postId/comments', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const postId = Array.isArray(req.params.postId) ? req.params.postId[0] : req.params.postId;

    const comments = await query<{ id: string; content: string; createdAt: Date; user: any }>(
      `SELECT c.id, c.content, c."createdAt",
              json_build_object('id', u.id, 'name', u.name, 'photoUrl', u."photoUrl") as user
       FROM "Comment" c
       LEFT JOIN "User" u ON u.id = c."userId"
       WHERE c."postId" = $1
       ORDER BY c."createdAt" ASC`,
      [postId]
    );

    res.json({ comments });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Comentar post
router.post('/:postId/comments', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const postId = Array.isArray(req.params.postId) ? req.params.postId[0] : req.params.postId;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Conteúdo é obrigatório' });
    }

    const commentId = generateId();

    await transaction(async (client) => {
      await client.query(
        'INSERT INTO "Comment" (id, "postId", "userId", content, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, NOW(), NOW())',
        [commentId, postId, req.userId, content]
      );
      await client.query('UPDATE "Post" SET "commentsCount" = "commentsCount" + 1 WHERE id = $1', [postId]);
    });

    const comment = await queryOne<{ id: string; content: string; user: any }>(
      `SELECT c.*, json_build_object('id', u.id, 'name', u.name, 'photoUrl', u."photoUrl") as user
       FROM "Comment" c
       LEFT JOIN "User" u ON u.id = c."userId"
       WHERE c.id = $1`,
      [commentId]
    );

    res.status(201).json({ comment });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Reportar post
router.post('/:postId/report', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });

    const postId = Array.isArray(req.params.postId) ? req.params.postId[0] : req.params.postId;
    const { reason } = req.body as { reason?: string };

    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return res.status(400).json({ error: 'reason é obrigatório' });
    }

    const hasTable = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'PostReport') as exists`
    );
    if (!hasTable?.exists) {
      return res.status(501).json({ error: 'Tabela PostReport não existe. Execute migrate-post-reports.sql' });
    }

    const post = await queryOne<{ id: string }>(
      'SELECT id FROM "Post" WHERE id = $1',
      [postId]
    );
    if (!post) return res.status(404).json({ error: 'Post não encontrado' });

    const reportId = generateId();
    await query(
      `INSERT INTO "PostReport" (id, "postId", "reporterId", reason, status, "createdAt")
       VALUES ($1, $2, $3, $4, 'pending', NOW())
       ON CONFLICT ("postId", "reporterId") DO UPDATE SET reason = EXCLUDED.reason, status = 'pending'`,
      [reportId, postId, req.userId, reason.trim()]
    );

    res.status(201).json({ message: 'Reporte enviado com sucesso' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Deletar post (dono do post, admin ou moderador)
router.delete('/:postId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const postId = Array.isArray(req.params.postId) ? req.params.postId[0] : req.params.postId;

    const post = await queryOne<{ userId: string }>(
      'SELECT "userId" FROM "Post" WHERE id = $1',
      [postId]
    );

    if (!post) {
      return res.status(404).json({ error: 'Post não encontrado' });
    }

    const isOwner = post.userId === req.userId;
    const isAdminOrMod = req.user?.role === UserRole.ADMIN || req.user?.role === UserRole.MODERATOR;

    if (!isOwner && !isAdminOrMod) {
      return res.status(403).json({ error: 'Sem permissão para excluir este post' });
    }

    await query('DELETE FROM "Post" WHERE id = $1', [postId]);

    res.json({ message: 'Post deletado com sucesso' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
