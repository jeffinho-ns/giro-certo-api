import { Router, Request, Response } from 'express';
import { AlertService, AlertType, AlertSeverity } from '../services/alert.service';
import { authenticateToken, AuthRequest, requireModerator } from '../middleware/auth';

const router = Router();
const alertService = new AlertService();

// Listar alertas do usuário logado (para usuários comuns)
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const partnerId = req.user?.partnerId;
    
    const filters: any = {
      limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
      offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
    };

    // Filtrar por userId ou partnerId do usuário logado
    if (partnerId) {
      filters.partnerId = partnerId;
    } else if (userId) {
      filters.userId = userId;
    }

    if (req.query.isRead !== undefined) {
      filters.isRead = req.query.isRead === 'true';
    }

    const result = await alertService.listAlerts(filters);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Listar alertas (apenas moderadores/admin)
router.get('/', authenticateToken, requireModerator, async (req: Request, res: Response) => {
  try {
    const filters = {
      type: req.query.type as AlertType | undefined,
      severity: req.query.severity as AlertSeverity | undefined,
      userId: req.query.userId as string | undefined,
      partnerId: req.query.partnerId as string | undefined,
      isRead: req.query.isRead === 'true' ? true : req.query.isRead === 'false' ? false : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
    };

    const result = await alertService.listAlerts(filters);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Buscar alerta por ID
router.get('/:alertId', authenticateToken, requireModerator, async (req: Request, res: Response) => {
  try {
    const alertId = Array.isArray(req.params.alertId)
      ? req.params.alertId[0]
      : req.params.alertId;

    const alerts = await alertService.listAlerts({ limit: 1, offset: 0 });
    const alert = alerts.alerts.find((a) => a.id === alertId);

    if (!alert) {
      return res.status(404).json({ error: 'Alerta não encontrado' });
    }

    res.json({ alert });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Marcar alerta como lido (usuário comum pode marcar seus próprios alertas)
router.put('/:alertId/read', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const alertId = Array.isArray(req.params.alertId)
      ? req.params.alertId[0]
      : req.params.alertId;

    // Verificar se o alerta pertence ao usuário (se não for admin/moderator)
    if (req.user?.role !== 'ADMIN' && req.user?.role !== 'MODERATOR') {
      const alert = await alertService.getAlertById(alertId);
      if (!alert) {
        return res.status(404).json({ error: 'Alerta não encontrado' });
      }
      
      // Verificar se o alerta pertence ao usuário ou parceiro
      const userId = req.userId;
      const partnerId = req.user?.partnerId;
      
      if (alert.userId !== userId && alert.partnerId !== partnerId) {
        return res.status(403).json({ error: 'Você não tem permissão para marcar este alerta como lido' });
      }
    }

    const updatedAlert = await alertService.markAsRead(alertId);
    res.json({ alert: updatedAlert });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Marcar todos como lidos (usuário comum pode marcar seus próprios alertas)
router.put('/read-all', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    let userId: string | undefined;
    let partnerId: string | undefined;

    // Se não for admin/moderator, usar apenas os alertas do próprio usuário
    if (req.user?.role !== 'ADMIN' && req.user?.role !== 'MODERATOR') {
      userId = req.userId;
      partnerId = req.user?.partnerId;
    } else {
      // Admin/moderator pode especificar userId ou partnerId
      userId = req.query.userId as string | undefined;
      partnerId = req.query.partnerId as string | undefined;
    }

    const count = await alertService.markAllAsRead(userId, partnerId);
    res.json({ message: `${count} alertas marcados como lidos` });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Deletar alerta
router.delete('/:alertId', authenticateToken, requireModerator, async (req: Request, res: Response) => {
  try {
    const alertId = Array.isArray(req.params.alertId)
      ? req.params.alertId[0]
      : req.params.alertId;

    await alertService.deleteAlert(alertId);
    res.json({ message: 'Alerta deletado com sucesso' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Estatísticas de alertas
router.get('/stats/summary', authenticateToken, requireModerator, async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string | undefined;
    const partnerId = req.query.partnerId as string | undefined;

    const stats = await alertService.getAlertStats(userId, partnerId);
    res.json(stats);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Verificar e criar alertas automáticos (endpoint para chamar via cron)
router.post('/check', authenticateToken, requireModerator, async (req: Request, res: Response) => {
  try {
    const alertsCreated = await alertService.checkAndCreateAlerts();
    res.json({
      message: `${alertsCreated} alertas criados`,
      alertsCreated,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
