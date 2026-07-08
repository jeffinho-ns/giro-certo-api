import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { StoreReadinessService } from '../services/store-readiness.service';
import { StoreTemplatesService } from '../services/store-templates.service';
import { StoreAuditService } from '../services/store-audit.service';
import { queryOne } from '../lib/db';
import { notifyLinkedLojistasOfCatalogChange } from '../services/store-lojista-notify.service';

const readinessService = new StoreReadinessService();
const templatesService = new StoreTemplatesService();
const auditService = new StoreAuditService();

function paramPartnerId(req: AuthRequest): string {
  const raw = req.params.partnerId;
  const partnerId = Array.isArray(raw) ? raw[0] : raw;
  if (!partnerId?.trim()) throw new Error('partnerId obrigatório');
  return partnerId.trim();
}

/**
 * Endpoints admin de gestão de loja (/api/store/admin/*).
 */
export class StoreAdminController {
  getReadiness = async (req: AuthRequest, res: Response) => {
    try {
      const partnerId = paramPartnerId(req);
      const items = await readinessService.getReadinessChecklist(partnerId);
      res.json({ partnerId, items });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  getStats = async (req: AuthRequest, res: Response) => {
    try {
      const partnerId = paramPartnerId(req);
      const stats = await queryOne<{
        ordersLast7Days: string;
        revenueLast7Days: string;
        avgRating: string | null;
        reviewCount: string;
      }>(
        `SELECT
           (SELECT COUNT(*)::text FROM "StoreOrder"
            WHERE "partnerId" = $1
              AND "createdAt" >= NOW() - INTERVAL '7 days'
              AND status NOT IN ('awaiting_payment', 'cancelled', 'rejected')) AS "ordersLast7Days",
           (SELECT COALESCE(SUM(total), 0)::text FROM "StoreOrder"
            WHERE "partnerId" = $1
              AND "createdAt" >= NOW() - INTERVAL '7 days'
              AND status NOT IN ('awaiting_payment', 'cancelled', 'rejected')) AS "revenueLast7Days",
           (SELECT AVG(rating)::text FROM "StoreReview" WHERE "partnerId" = $1) AS "avgRating",
           (SELECT COUNT(*)::text FROM "StoreReview" WHERE "partnerId" = $1) AS "reviewCount"`,
        [partnerId]
      );

      res.json({
        partnerId,
        ordersLast7Days: Number(stats?.ordersLast7Days ?? 0),
        revenueLast7Days: Number(stats?.revenueLast7Days ?? 0),
        avgRating: stats?.avgRating != null ? Number(Number(stats.avgRating).toFixed(2)) : null,
        reviewCount: Number(stats?.reviewCount ?? 0),
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  listTemplates = async (_req: AuthRequest, res: Response) => {
    try {
      const templates = templatesService.listTemplates();
      res.json({ templates });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  applyTemplate = async (req: AuthRequest, res: Response) => {
    try {
      const partnerId = paramPartnerId(req);
      const templateId = String(req.body?.templateId ?? '').trim();
      if (!templateId) {
        return res.status(400).json({ error: 'templateId é obrigatório' });
      }

      const result = await templatesService.applyTemplate(partnerId, templateId);

      await auditService.logAudit(
        partnerId,
        { userId: req.user!.id, role: req.user!.role },
        'apply_template',
        'template',
        templateId,
        `Template "${result.template.name}" aplicado`
      );

      await notifyLinkedLojistasOfCatalogChange(req.app, partnerId, 'Template de vitrine aplicado pela equipe', {
        templateId,
        actorUserId: req.user!.id,
      });

      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  getAuditLog = async (req: AuthRequest, res: Response) => {
    try {
      const partnerId = paramPartnerId(req);
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
      const entries = await auditService.listByPartner(partnerId, { limit });
      res.json({ partnerId, entries });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };
}
