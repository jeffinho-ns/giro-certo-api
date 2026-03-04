import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { UserRole } from '../types';
import { query, queryOne, transaction } from '../lib/db';
import { Post } from '../types';
import { generateId } from '../utils/id';
import { AlertService, AlertType, AlertSeverity } from '../services/alert.service';
import { sendPushToUser } from '../services/fcm.service';

const router = Router();
const alertService = new AlertService();

// Listar posts da comunidade (opcional: userId, pilotType=delivery|lazer, hashtag, postType, reportedOnly)
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const userId = (req.query.userId as string)?.trim() || null;
    const pilotType = (req.query.pilotType as string)?.trim()?.toLowerCase() || null;
    const hashtag = (req.query.hashtag as string)?.trim()?.replace(/^#/, '') || null;
    const postType = (req.query.postType as string)?.trim()?.toUpperCase() || null;
    const reportedOnly = req.query.reported === 'true' || req.query.reported === '1';

    const conditions: string[] = [];
    const params: (number | string)[] = [limit, offset];
    let paramIdx = 3;
    if (userId) {
      conditions.push(`p."userId" = $${paramIdx++}`);
      params.push(userId);
    }
    if (pilotType === 'delivery') {
      conditions.push(`u."pilotProfile" = 'TRABALHO'`);
    } else if (pilotType === 'lazer') {
      conditions.push(`(u."pilotProfile" IS NULL OR u."pilotProfile" != 'TRABALHO')`);
    }
    if (hashtag) {
      conditions.push(`p."hashtags" @> ARRAY[$${paramIdx++}]`);
      params.push(hashtag);
    }
    if (postType) {
      conditions.push(`COALESCE(p."postType", 'NORMAL') = $${paramIdx++}`);
      params.push(postType);
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

    // Reação do utilizador autenticado (PostReaction ou PostLike)
    params.push(req.userId ?? '');
    const currentUserParam = params.length;
    const userReactionSelect = hasReactionsTable?.exists
      ? `, (SELECT pr."reactionType" FROM "PostReaction" pr WHERE pr."postId" = p.id AND pr."userId" = $${currentUserParam} LIMIT 1) as "userReactionPr",
         (SELECT 1 FROM "PostLike" pl2 WHERE pl2."postId" = p.id AND pl2."userId" = $${currentUserParam} LIMIT 1) as "userLiked"`
      : `, (SELECT 1 FROM "PostLike" pl2 WHERE pl2."postId" = p.id AND pl2."userId" = $${currentUserParam} LIMIT 1) as "userLiked"`;

    const selectReportInfo = reportedOnly && hasReportTable ? `
        (SELECT json_agg(json_build_object('reason', pr.reason, 'createdAt', pr."createdAt"))
         FROM "PostReport" pr WHERE pr."postId" = p.id AND pr.status = 'pending') as "reportInfo",
        ` : '';

    const hasReactionsTable = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'PostReaction') as exists`
    );
    const reactionsSubquery = hasReactionsTable?.exists
      ? `, (SELECT json_object_agg(pr."reactionType", pr.cnt) FROM (
          SELECT "reactionType", COUNT(*)::int as cnt FROM "PostReaction" WHERE "postId" = p.id GROUP BY "reactionType"
        ) pr) as reactions`
      : '';

    const posts = await query<Post & { user: any; likes: any[]; comments: any[]; reportInfo?: any; reactions?: any }>(
      `SELECT 
        p.id, p."userId", p.content, p.images, p."likesCount", p."commentsCount", p."createdAt", p."updatedAt",
        COALESCE(p."postType", 'NORMAL') as "postType",
        COALESCE(p."hashtags", '{}') as hashtags,
        ${selectReportInfo}
        json_build_object('id', u.id, 'name', u.name, 'photoUrl', u."photoUrl", 'pilotProfile', u."pilotProfile") as user,
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
        ${reactionsSubquery}
        ${userReactionSelect}
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

    const postsWithReaction = posts.map((p: any) => {
      const { userReactionPr, userLiked, ...rest } = p;
      return {
        ...rest,
        userReaction: userReactionPr ?? (userLiked ? 'LIKE' : null),
      };
    });

    res.json({ posts: postsWithReaction });
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

    const { content, images, postType, hashtags } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Conteúdo é obrigatório' });
    }

    const postId = generateId();
    const imgArray = Array.isArray(images) ? (images as string[]) : [];
    const typeStr = (typeof postType === 'string' && postType.trim()) ? postType.trim().toUpperCase() : 'NORMAL';
    const hashtagArray = Array.isArray(hashtags) ? (hashtags as string[]).filter((h: any) => typeof h === 'string' && h.trim()) : [];

    await query(
      `INSERT INTO "Post" (id, "userId", content, images, "likesCount", "commentsCount", "postType", "hashtags", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 0, 0, $5, $6, NOW(), NOW())`,
      [postId, req.userId, content, imgArray.length > 0 ? imgArray : [], typeStr, hashtagArray]
    );

    // Desbloquear conquista "Primeiro post" se for o primeiro do utilizador
    const postCount = await queryOne<{ n: string }>(
      'SELECT COUNT(*)::text as n FROM "Post" WHERE "userId" = $1',
      [req.userId]
    );
    if (postCount && parseInt(postCount.n, 10) === 1) {
      const hasAchievement = await queryOne<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'UserAchievement') as exists`
      );
      if (hasAchievement?.exists) {
        const existing = await queryOne<{ id: string }>(
          'SELECT id FROM "UserAchievement" WHERE "userId" = $1 AND "achievementId" = $2',
          [req.userId, 'ach_first_post']
        );
        if (!existing) {
          await query(
            'INSERT INTO "UserAchievement" (id, "userId", "achievementId") VALUES ($1, $2, $3)',
            [generateId(), req.userId, 'ach_first_post']
          );
        }
      }
    }

    const post = await queryOne<Post & { user: any }>(
      `SELECT p.*, json_build_object('id', u.id, 'name', u.name, 'photoUrl', u."photoUrl", 'pilotProfile', u."pilotProfile") as user
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

// Reação num post (LIKE, BOA_ROTA, BOA_DICA). LIKE continua a usar PostLike; aqui só BOA_ROTA e BOA_DICA ou toggle LIKE em PostReaction.
router.post('/:postId/reactions', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });

    const postId = Array.isArray(req.params.postId) ? req.params.postId[0] : req.params.postId;
    const reactionType = ((req.body as { reaction?: string })?.reaction || 'LIKE').trim().toUpperCase();
    if (!['LIKE', 'BOA_ROTA', 'BOA_DICA'].includes(reactionType)) {
      return res.status(400).json({ error: 'reaction deve ser LIKE, BOA_ROTA ou BOA_DICA' });
    }

    const hasTable = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'PostReaction') as exists`
    );
    if (!hasTable?.exists) {
      const post = await queryOne<{ likesCount: number }>('SELECT "likesCount" FROM "Post" WHERE id = $1', [postId]);
      return res.json({ likesCount: post?.likesCount ?? 0 });
    }

    const existing = await queryOne<{ id: string; reactionType: string }>(
      'SELECT id, "reactionType" FROM "PostReaction" WHERE "postId" = $1 AND "userId" = $2',
      [postId, req.userId]
    );

    await transaction(async (client: any) => {
      if (existing) {
        if (existing.reactionType === reactionType) {
          await client.query('DELETE FROM "PostReaction" WHERE id = $1', [existing.id]);
        } else {
          await client.query('UPDATE "PostReaction" SET "reactionType" = $1 WHERE id = $2', [reactionType, existing.id]);
        }
      } else {
        const rid = generateId();
        await client.query(
          'INSERT INTO "PostReaction" (id, "postId", "userId", "reactionType") VALUES ($1, $2, $3, $4)',
          [rid, postId, req.userId, reactionType]
        );
      }
    });

    const counts = await queryOne<{ like_count: string; boa_rota: string; boa_dica: string }>(
      `SELECT
        (SELECT COUNT(*)::text FROM "PostLike" WHERE "postId" = $1) as like_count,
        (SELECT COUNT(*)::text FROM "PostReaction" WHERE "postId" = $1 AND "reactionType" = 'BOA_ROTA') as boa_rota,
        (SELECT COUNT(*)::text FROM "PostReaction" WHERE "postId" = $1 AND "reactionType" = 'BOA_DICA') as boa_dica`,
      [postId]
    );
    const userReactionRow = await queryOne<{ reactionType: string } | null>(
      'SELECT "reactionType" FROM "PostReaction" WHERE "postId" = $1 AND "userId" = $2 LIMIT 1',
      [postId, req.userId]
    );
    const userLiked = await queryOne<{ id: string } | null>(
      'SELECT id FROM "PostLike" WHERE "postId" = $1 AND "userId" = $2 LIMIT 1',
      [postId, req.userId]
    );
    const likesCount = parseInt(counts?.like_count ?? '0', 10);
    const userReaction = userReactionRow?.reactionType ?? (userLiked ? 'LIKE' : null);
    res.json({
      liked: userReaction === 'LIKE' || !!userLiked,
      userReaction,
      likesCount,
      reactions: {
        LIKE: likesCount,
        BOA_ROTA: parseInt(counts?.boa_rota ?? '0', 10),
        BOA_DICA: parseInt(counts?.boa_dica ?? '0', 10),
      },
    });
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

    // Notificar dono do post (se não for o próprio)
    if (!existingLike) {
      const post = await queryOne<{ userId: string }>('SELECT "userId" FROM "Post" WHERE id = $1', [postId]);
      const actor = await queryOne<{ name: string }>('SELECT name FROM "User" WHERE id = $1', [req.userId]);
      if (post && post.userId !== req.userId) {
        const alert = await alertService.createAlert({
          type: AlertType.POST_LIKE,
          severity: AlertSeverity.LOW,
          title: 'Nova curtida',
          message: `${actor?.name || 'Alguém'} curtiu a tua publicação.`,
          userId: post.userId,
          metadata: { postId, actorId: req.userId },
        });
        const io = (req as any).app?.get?.('io');
        if (io?.to) {
          const payload = { ...alert, createdAt: (alert as any).createdAt instanceof Date ? (alert as any).createdAt.toISOString() : (alert as any).createdAt };
          io.to(`user:${post.userId}`).emit('notification', payload);
        }
        await sendPushToUser(post.userId, 'Nova curtida', `${actor?.name || 'Alguém'} curtiu a tua publicação.`, { type: 'post_like', postId });
      }
    }

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
    const { content } = req.body as { content?: string };
    const contentStr = typeof content === 'string' ? content.trim() : '';

    if (!contentStr) {
      return res.status(400).json({ error: 'Conteúdo é obrigatório' });
    }

    const post = await queryOne<{ userId: string }>('SELECT "userId" FROM "Post" WHERE id = $1', [postId]);
    const commentId = generateId();

    await transaction(async (client) => {
      await client.query(
        'INSERT INTO "Comment" (id, "postId", "userId", content, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, NOW(), NOW())',
        [commentId, postId, req.userId, contentStr]
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

    // Notificar dono do post (se não for o próprio)
    if (post && post.userId !== req.userId) {
      const actor = await queryOne<{ name: string }>('SELECT name FROM "User" WHERE id = $1', [req.userId]);
      const preview = contentStr.slice(0, 50) + (contentStr.length > 50 ? '...' : '');
      const alert = await alertService.createAlert({
        type: AlertType.POST_COMMENT,
        severity: AlertSeverity.LOW,
        title: 'Novo comentário',
        message: `${actor?.name || 'Alguém'} comentou: ${preview}`,
        userId: post.userId,
        metadata: { postId, commentId, actorId: req.userId },
      });
      const io = (req as any).app?.get?.('io');
      if (io?.to) {
        const payload = { ...alert, createdAt: (alert as any).createdAt instanceof Date ? (alert as any).createdAt.toISOString() : (alert as any).createdAt };
        io.to(`user:${post.userId}`).emit('notification', payload);
      }
      await sendPushToUser(post.userId, 'Novo comentário', `${actor?.name || 'Alguém'} comentou na tua publicação.`, { type: 'post_comment', postId });
    }

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
