import { Router, Request, Response } from 'express';
import { PartnerService } from '../services/partner.service';
import { authenticateToken, AuthRequest, requireAdmin, requireModerator } from '../middleware/auth';
import { queryOne } from '../lib/db';
import {
  CreatePartnerDto,
  UpdatePartnerDto,
  CreatePartnerPaymentDto,
  UpdatePartnerPaymentDto,
  RecordPaymentDto,
} from '../types';

const router = Router();
const partnerService = new PartnerService();

// Listar parceiros (com filtros)
router.get('/', authenticateToken, requireModerator, async (req: Request, res: Response) => {
  try {
    const filters = {
      type: req.query.type as string | undefined,
      isBlocked: req.query.isBlocked ? req.query.isBlocked === 'true' : undefined,
      isTrusted: req.query.isTrusted ? req.query.isTrusted === 'true' : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
    };

    const result = await partnerService.listPartners(filters);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Buscar própria loja (para lojistas)
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    // Buscar usuário para obter partnerId
    const user = await queryOne<{ partnerId: string | null }>(
      'SELECT "partnerId" FROM "User" WHERE id = $1',
      [req.userId]
    );

    if (!user || !user.partnerId) {
      return res.status(404).json({ error: 'Você não está vinculado a nenhuma loja' });
    }

    const partner = await partnerService.getPartnerById(user.partnerId);

    if (!partner) {
      return res.status(404).json({ error: 'Loja não encontrada' });
    }

    res.json({ partner });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Buscar parceiro por ID
router.get('/:partnerId', authenticateToken, requireModerator, async (req: Request, res: Response) => {
  try {
    const partnerId = Array.isArray(req.params.partnerId)
      ? req.params.partnerId[0]
      : req.params.partnerId;

    const partner = await partnerService.getPartnerById(partnerId);

    if (!partner) {
      return res.status(404).json({ error: 'Parceiro não encontrado' });
    }

    res.json({ partner });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Criar parceiro (apenas admin)
router.post('/', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const data: CreatePartnerDto = req.body;
    const partner = await partnerService.createPartner(data);
    res.status(201).json({ partner });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Atualizar parceiro (apenas admin)
router.put('/:partnerId', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const partnerId = Array.isArray(req.params.partnerId)
      ? req.params.partnerId[0]
      : req.params.partnerId;
    const data: UpdatePartnerDto = req.body;

    const partner = await partnerService.updatePartner(partnerId, data);
    res.json({ partner });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Bloquear/desbloquear parceiro (apenas admin)
router.put('/:partnerId/block', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const partnerId = Array.isArray(req.params.partnerId)
      ? req.params.partnerId[0]
      : req.params.partnerId;
    const { isBlocked } = req.body;

    if (typeof isBlocked !== 'boolean') {
      return res.status(400).json({ error: 'isBlocked deve ser um booleano' });
    }

    const partner = await partnerService.updatePartner(partnerId, { isBlocked });
    res.json({
      message: isBlocked ? 'Parceiro bloqueado' : 'Parceiro desbloqueado',
      partner,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================
// ROTAS DE PAGAMENTO
// ============================================

// Criar plano de pagamento (apenas admin)
router.post('/:partnerId/payment', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const partnerId = Array.isArray(req.params.partnerId)
      ? req.params.partnerId[0]
      : req.params.partnerId;
    const data: CreatePartnerPaymentDto = {
      ...req.body,
      partnerId,
    };

    const payment = await partnerService.createPaymentPlan(data);
    res.status(201).json({ payment });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Buscar plano de pagamento
router.get('/:partnerId/payment', authenticateToken, requireModerator, async (req: Request, res: Response) => {
  try {
    const partnerId = Array.isArray(req.params.partnerId)
      ? req.params.partnerId[0]
      : req.params.partnerId;

    const partner = await partnerService.getPartnerById(partnerId);

    if (!partner) {
      return res.status(404).json({ error: 'Parceiro não encontrado' });
    }

    res.json({ payment: (partner as any).payment });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Atualizar plano de pagamento (apenas admin)
router.put('/payment/:paymentId', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const paymentId = Array.isArray(req.params.paymentId)
      ? req.params.paymentId[0]
      : req.params.paymentId;
    const data: UpdatePartnerPaymentDto = req.body;

    const payment = await partnerService.updatePaymentPlan(paymentId, data);
    res.json({ payment });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Registrar pagamento (apenas admin)
router.post('/payment/:paymentId/record', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const paymentId = Array.isArray(req.params.paymentId)
      ? req.params.paymentId[0]
      : req.params.paymentId;
    const data: RecordPaymentDto = {
      ...req.body,
      paymentDate: req.body.paymentDate ? new Date(req.body.paymentDate) : new Date(),
    };

    const payment = await partnerService.recordPayment(paymentId, data);
    res.json({ payment });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Listar parceiros inadimplentes (apenas admin)
router.get('/reports/overdue', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const partners = await partnerService.getOverduePartners();
    res.json({ partners });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
