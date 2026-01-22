import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { query, queryOne, transaction } from '../lib/db';
import { Post } from '../types';
import { generateId } from '../utils/id';

const router = Router();

// Listar posts da comunidade
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const posts = await query<Post & { user: any; likes: any[]; comments: any[] }>(
      `SELECT 
        p.*,
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
       GROUP BY p.id, u.id
       ORDER BY p."createdAt" DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
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

// Deletar post
router.delete('/:postId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const postId = Array.isArray(req.params.postId) ? req.params.postId[0] : req.params.postId;

    await query('DELETE FROM "Post" WHERE id = $1', [postId]);

    res.json({ message: 'Post deletado com sucesso' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
