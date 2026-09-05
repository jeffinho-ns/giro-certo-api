import { Router, Request, Response } from 'express';
import { query } from '../lib/db';
import { DeliveryRegistrationService } from '../services/delivery-registration.service';
import { AlertService, AlertType, AlertSeverity } from '../services/alert.service';
import { sendPushToUser } from '../services/fcm.service';
import { authenticateToken, AuthRequest, requireAdmin, requireModerator } from '../middleware/auth';
import { CreateDeliveryRegistrationDto, UpdateDeliveryRegistrationStatusDto } from '../types';

const router = Router();
const registrationService = new DeliveryRegistrationService();
const alertService = new AlertService();

// Criar novo registro de delivery (entregador) - aceitando imagens em base64 ou multipart
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const data: CreateDeliveryRegistrationDto = req.body;

    const bodyBytes = Number(req.headers['content-length'] || 0);
    if (bodyBytes > 45 * 1024 * 1024) {
      return res.status(413).json({
        error:
          'Fotos muito grandes. Tire novamente com menor resolução ou comprima antes de enviar.',
      });
    }

    // Converter imagens base64 em buffers se fornecidas
    const processedData = {
      ...data,
      selfieWithDocData: data.selfieWithDocBase64
        ? Buffer.from(data.selfieWithDocBase64, 'base64')
        : null,
      motoWithPlateData: data.motoWithPlateBase64
        ? Buffer.from(data.motoWithPlateBase64, 'base64')
        : null,
      platePlateCloseupData: data.platePlateCloseupBase64
        ? Buffer.from(data.platePlateCloseupBase64, 'base64')
        : null,
      cnhPhotoData: data.cnhPhotoBase64
        ? Buffer.from(data.cnhPhotoBase64, 'base64')
        : null,
      crlvPhotoData: data.crlvPhotoBase64
        ? Buffer.from(data.crlvPhotoBase64, 'base64')
        : null,
      bikeOptionalReceiptData: data.bikeOptionalReceiptBase64
        ? Buffer.from(data.bikeOptionalReceiptBase64, 'base64')
        : null,
    };

    // Liberar strings base64 do body o quanto antes (GC) — evita OOM no Render
    delete (data as any).selfieWithDocBase64;
    delete (data as any).motoWithPlateBase64;
    delete (data as any).platePlateCloseupBase64;
    delete (data as any).cnhPhotoBase64;
    delete (data as any).crlvPhotoBase64;
    delete (data as any).bikeOptionalReceiptBase64;

    const registration = await registrationService.createRegistration(
      req.userId,
      processedData as CreateDeliveryRegistrationDto
    );

    res.status(201).json({ registration });
  } catch (error: any) {
    console.error('[delivery-registration] create failed:', error?.message || error);
    const status =
      error?.statusCode === 413 || error?.type === 'entity.too.large' ? 413 : 400;
    res.status(status).json({
      error: error?.message || 'Falha ao criar registro de delivery',
    });
  }
});

// Listar todos os registros de delivery de um user (moderação)
router.get(
  '/admin/by-user/:userId',
  authenticateToken,
  requireModerator,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
      if (!userId) {
        return res.status(400).json({ error: 'userId inválido' });
      }
      const registrations = await registrationService.getRegistrationsByUserId(userId);
      return res.json({ registrations });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  }
);

// Listar registros do usuário autenticado (metadados, sem fotos — app mobile)
router.get(
  '/user/mine/summary',
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Usuário não autenticado' });
      }

      const registrations =
        await registrationService.getRegistrationSummariesByUserId(req.userId);

      res.json({ registrations });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// Listar registros do usuário autenticado (com imagens — admin / revisão)
router.get('/user/mine', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const lite =
      req.query.lite === '1' ||
      req.query.lite === 'true' ||
      req.query.summary === '1';

    const registrations = lite
      ? await registrationService.getRegistrationSummariesByUserId(req.userId)
      : await registrationService.getRegistrationsByUserId(req.userId);

    res.json({ registrations });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Buscar um registro por ID
router.get('/:registrationId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const registrationId = Array.isArray(req.params.registrationId)
      ? req.params.registrationId[0]
      : req.params.registrationId;

    const registration = await registrationService.getRegistrationById(
      registrationId
    );

    if (!registration) {
      return res.status(404).json({ error: 'Registro não encontrado' });
    }

    // Verificar permissão: usuário só vê seu próprio registro, ou admin vê qualquer um
    if (
      registration.userId !== req.userId &&
      req.user?.role !== 'ADMIN' &&
      req.user?.role !== 'MODERATOR'
    ) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    res.json({ registration });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Listar registros pendentes (admin)
router.get('/pending/review-list', authenticateToken, requireModerator, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await registrationService.getPendingRegistrations(limit, offset);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Atualizar status (aprovado/rejeitado) - apenas admin
router.put('/:registrationId/status', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const registrationId = Array.isArray(req.params.registrationId)
      ? req.params.registrationId[0]
      : req.params.registrationId;

    const data: UpdateDeliveryRegistrationStatusDto = {
      ...req.body,
      approvedBy: req.userId,
    };

    const registration = await registrationService.updateRegistrationStatus(
      registrationId,
      data
    );

    if (data.status === 'APPROVED' && registration?.userId) {
      await query(
        `UPDATE "User" SET "hasVerifiedDocuments" = true, "updatedAt" = NOW() WHERE id = $1`,
        [registration.userId]
      );
    } else if (data.status === 'REJECTED' && registration?.userId) {
      await query(
        `UPDATE "User" SET "hasVerifiedDocuments" = false, "updatedAt" = NOW() WHERE id = $1`,
        [registration.userId]
      );
    }

    if (data.status === 'APPROVED' && registration?.userId) {
      const alert = await alertService.createAlert({
        type: AlertType.DELIVERY_APPROVED,
        severity: AlertSeverity.MEDIUM,
        title: 'Documentação aprovada',
        message: 'A tua documentação de entregador foi aprovada. Já podes fazer entregas.',
        userId: registration.userId,
      });
      const io = (req as any).app?.get?.('io');
      if (io?.to) {
        io.to(`user:${registration.userId}`).emit('notification', alert);
      }
      await sendPushToUser(
        registration.userId,
        'Cadastro aprovado',
        'Pode aceitar corridas de delivery. Boa jornada!',
        { type: 'DELIVERY_REGISTRATION_APPROVED' }
      );
    }

    res.json({ registration });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Obter estatísticas (admin)
router.get('/stats/overview', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const stats = await registrationService.getStatistics();
    res.json({ stats });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
