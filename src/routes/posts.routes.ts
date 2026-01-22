import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';

const router = Router();

// Listar posts da comunidade
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const posts = await prisma.post.findMany({
      include: {
        user: {
          select: {
            id: true,
            name: true,
            photoUrl: true,
          },
        },
        likes: {
          select: {
            userId: true,
          },
        },
        comments: {
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                photoUrl: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(req.query.limit as string) || 50,
      skip: parseInt(req.query.offset as string) || 0,
    });

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

    const post = await prisma.post.create({
      data: {
        userId: req.userId,
        content,
        images: images || [],
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            photoUrl: true,
          },
        },
      },
    });

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

    const { postId } = req.params;

    // Verificar se já curtiu
    const existingLike = await prisma.postLike.findUnique({
      where: {
        postId_userId: {
          postId,
          userId: req.userId,
        },
      },
    });

    if (existingLike) {
      // Remover like
      await prisma.postLike.delete({
        where: { id: existingLike.id },
      });
      await prisma.post.update({
        where: { id: postId },
        data: { likesCount: { decrement: 1 } },
      });
      return res.json({ liked: false });
    }

    // Adicionar like
    await prisma.postLike.create({
      data: {
        postId,
        userId: req.userId,
      },
    });
    await prisma.post.update({
      where: { id: postId },
      data: { likesCount: { increment: 1 } },
    });

    res.json({ liked: true });
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

    const { postId } = req.params;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Conteúdo é obrigatório' });
    }

    const comment = await prisma.comment.create({
      data: {
        postId,
        userId: req.userId,
        content,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            photoUrl: true,
          },
        },
      },
    });

    // Incrementar contador de comentários
    await prisma.post.update({
      where: { id: postId },
      data: { commentsCount: { increment: 1 } },
    });

    res.status(201).json({ comment });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Listar posts reportados (admin)
router.get('/reported', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    // TODO: Verificar se é admin
    // Por enquanto, qualquer usuário autenticado pode ver
    
    // Esta funcionalidade pode ser expandida com um sistema de reportes
    const posts = await prisma.post.findMany({
      where: {
        // Implementar lógica de reportes
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ posts });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Deletar post (moderação)
router.delete('/:postId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const { postId } = req.params;

    // TODO: Verificar se é admin ou se o post pertence ao usuário
    
    await prisma.post.delete({
      where: { id: postId },
    });

    res.json({ message: 'Post deletado com sucesso' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
