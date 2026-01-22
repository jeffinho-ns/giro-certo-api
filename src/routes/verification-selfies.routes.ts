import { Router, Request, Response } from 'express';
import { VerificationSelfieService } from '../services/verification-selfie.service';
import { authenticateToken, AuthRequest, requireAdmin, requireModerator } from '../middleware/auth';
import { CreateVerificationSelfieDto, UpdateVerificationSelfieDto } from '../types';

const router = Router();
const selfieService = new VerificationSelfieService();

// Criar selfie de verificação (entregador)
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const data: CreateVerificationSelfieDto = {
      ...req.body,
      userId: req.body.userId || req.userId, // Se não especificado, usa o usuário autenticado
    };

    if (!data.userId) {
      return res.status(400).json({ error: 'userId é obrigatório' });
    }

    // Verificar se o usuário pode criar selfie para este userId
    if (data.userId !== req.userId && req.user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Você não tem permissão para criar selfies para outros usuários' });
    }

    const selfie = await selfieService.createSelfie(data);
    res.status(201).json({ selfie });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Listar selfies de um entregador
router.get('/user/:userId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;

    // Verificar se o usuário pode ver selfies deste userId
    if (userId !== req.userId && req.user?.role !== 'ADMIN' && req.user?.role !== 'MODERATOR') {
      return res.status(403).json({ error: 'Você não tem permissão para ver selfies de outros usuários' });
    }

    const selfies = await selfieService.getSelfiesByUserId(userId);
    res.json({ selfies });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Buscar selfie por ID
router.get('/:selfieId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const selfieId = Array.isArray(req.params.selfieId) ? req.params.selfieId[0] : req.params.selfieId;
    const selfie = await selfieService.getSelfieById(selfieId);

    if (!selfie) {
      return res.status(404).json({ error: 'Selfie não encontrada' });
    }

    // Verificar se o usuário pode ver esta selfie
    const userId = (selfie as any).user?.id || (selfie as any).userId;
    if (userId !== req.userId && req.user?.role !== 'ADMIN' && req.user?.role !== 'MODERATOR') {
      return res.status(403).json({ error: 'Você não tem permissão para ver esta selfie' });
    }

    res.json({ selfie });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Listar selfies pendentes (admin/moderator)
router.get('/pending/review', authenticateToken, requireModerator, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await selfieService.getPendingSelfies(limit, offset);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Atualizar status da selfie (aprovado/rejeitado) - apenas admin
router.put('/:selfieId/status', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const selfieId = Array.isArray(req.params.selfieId) ? req.params.selfieId[0] : req.params.selfieId;
    const data: UpdateVerificationSelfieDto = {
      ...req.body,
      verifiedBy: req.userId, // ID do admin que está aprovando/rejeitando
    };

    const selfie = await selfieService.updateSelfieStatus(selfieId, data);
    res.json({ selfie });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Deletar selfie (apenas admin ou o próprio usuário)
router.delete('/:selfieId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const selfieId = Array.isArray(req.params.selfieId) ? req.params.selfieId[0] : req.params.selfieId;
    
    // Verificar se o usuário pode deletar esta selfie
    const selfie = await selfieService.getSelfieById(selfieId);
    if (!selfie) {
      return res.status(404).json({ error: 'Selfie não encontrada' });
    }

    const userId = (selfie as any).user?.id || (selfie as any).userId;
    if (userId !== req.userId && req.user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Você não tem permissão para deletar esta selfie' });
    }

    const result = await selfieService.deleteSelfie(selfieId);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
