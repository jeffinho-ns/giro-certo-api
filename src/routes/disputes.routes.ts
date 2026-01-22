import { Router, Request, Response } from 'express';
import { DisputeService } from '../services/dispute.service';
import { authenticateToken, AuthRequest, requireAdmin, requireModerator } from '../middleware/auth';
import { CreateDisputeDto, ResolveDisputeDto, DisputeStatus, DisputeType } from '../types';

const router = Router();
const disputeService = new DisputeService();

// Listar disputas (admin/moderator)
router.get('/', authenticateToken, requireModerator, async (req: Request, res: Response) => {
  try {
    const filters = {
      status: req.query.status as DisputeStatus | undefined,
      disputeType: req.query.disputeType as DisputeType | undefined,
      deliveryOrderId: req.query.deliveryOrderId as string | undefined,
      reportedBy: req.query.reportedBy as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
    };

    const result = await disputeService.listDisputes(filters);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Buscar disputa por ID
router.get('/:disputeId', authenticateToken, requireModerator, async (req: Request, res: Response) => {
  try {
    const disputeId = Array.isArray(req.params.disputeId)
      ? req.params.disputeId[0]
      : req.params.disputeId;

    const dispute = await disputeService.getDisputeById(disputeId);

    if (!dispute) {
      return res.status(404).json({ error: 'Disputa não encontrada' });
    }

    res.json({ dispute });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Criar disputa (qualquer usuário autenticado)
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const data: CreateDisputeDto = req.body;
    const dispute = await disputeService.createDispute(req.user.id, data);
    res.status(201).json({ dispute });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Resolver disputa (apenas admin)
router.put('/:disputeId/resolve', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const disputeId = Array.isArray(req.params.disputeId)
      ? req.params.disputeId[0]
      : req.params.disputeId;
    const data: ResolveDisputeDto = req.body;

    const dispute = await disputeService.resolveDispute(disputeId, req.user.id, data);
    res.json({
      message: 'Disputa resolvida com sucesso',
      dispute,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Atualizar status da disputa (admin)
router.put('/:disputeId/status', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const disputeId = Array.isArray(req.params.disputeId)
      ? req.params.disputeId[0]
      : req.params.disputeId;
    const { status } = req.body;

    if (!status || !Object.values(DisputeStatus).includes(status)) {
      return res.status(400).json({ error: 'Status inválido' });
    }

    const dispute = await disputeService.updateDisputeStatus(disputeId, status);
    res.json({ dispute });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Deletar disputa (apenas admin, apenas se fechada)
router.delete('/:disputeId', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const disputeId = Array.isArray(req.params.disputeId)
      ? req.params.disputeId[0]
      : req.params.disputeId;

    await disputeService.deleteDispute(disputeId);
    res.json({ message: 'Disputa deletada com sucesso' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Estatísticas de disputas (admin/moderator)
router.get('/stats/summary', authenticateToken, requireModerator, async (req: Request, res: Response) => {
  try {
    const stats = await disputeService.getDisputeStats();
    res.json(stats);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
