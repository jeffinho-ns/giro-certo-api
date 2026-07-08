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
      const checks = items.map((item) => ({
        key: item.key,
        label: item.label,
        passed: item.done,
        hint: item.hint,
      }));
      const score =
        checks.length > 0
          ? Math.round((checks.filter((c) => c.passed).length / checks.length) * 100)
          : 0;
      const ready = checks.length > 0 && checks.every((c) => c.passed);
      res.json({ partnerId, ready, score, checks });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  getStats = async (req: AuthRequest, res: Response) => {
    try {
      const partnerId = paramPartnerId(req);
      const stats = await queryOne<{
        ordersToday: string;
        ordersPending: string;
        productsActive: string;
        revenueToday: string;
        ordersLast7Days: string;
        revenueLast7Days: string;
        avgRating: string | null;
        reviewCount: string;
      }>(
        `SELECT
           (SELECT COUNT(*)::text FROM "StoreOrder" o
            WHERE o."partnerId" = $1
              AND (o."createdAt" AT TIME ZONE 'America/Sao_Paulo')::date =
                  (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
              AND o.status NOT IN ('cancelled', 'rejected')) AS "ordersToday",
           (SELECT COUNT(*)::text FROM "StoreOrder" o
            WHERE o."partnerId" = $1
              AND o.status IN (
                'awaiting_payment', 'paid', 'accepted_by_store', 'dispatched', 'in_delivery'
              )) AS "ordersPending",
           (SELECT COUNT(*)::text FROM "Product" p
            WHERE p."partnerId" = $1 AND p.active = true) AS "productsActive",
           (SELECT COALESCE(SUM(o.total), 0)::text FROM "StoreOrder" o
            WHERE o."partnerId" = $1
              AND o.status IN ('paid', 'accepted_by_store', 'dispatched', 'in_delivery', 'completed')
              AND (
                (
                  o."paidAt" IS NOT NULL
                  AND (o."paidAt" AT TIME ZONE 'America/Sao_Paulo')::date =
                      (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
                )
                OR (
                  o."paidAt" IS NULL
                  AND (o."createdAt" AT TIME ZONE 'America/Sao_Paulo')::date =
                      (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
                )
              )) AS "revenueToday",
           (SELECT COUNT(*)::text FROM "StoreOrder" o
            WHERE o."partnerId" = $1
              AND o."createdAt" >= NOW() - INTERVAL '7 days'
              AND o.status NOT IN ('awaiting_payment', 'cancelled', 'rejected')) AS "ordersLast7Days",
           (SELECT COALESCE(SUM(o.total), 0)::text FROM "StoreOrder" o
            WHERE o."partnerId" = $1
              AND o."createdAt" >= NOW() - INTERVAL '7 days'
              AND o.status NOT IN ('awaiting_payment', 'cancelled', 'rejected')) AS "revenueLast7Days",
           (SELECT AVG(rating)::text FROM "StoreReview" WHERE "partnerId" = $1) AS "avgRating",
           (SELECT COUNT(*)::text FROM "StoreReview" WHERE "partnerId" = $1) AS "reviewCount"`,
        [partnerId]
      );

      res.json({
        partnerId,
        ordersToday: Number(stats?.ordersToday ?? 0),
        ordersPending: Number(stats?.ordersPending ?? 0),
        productsActive: Number(stats?.productsActive ?? 0),
        revenueToday: Number(stats?.revenueToday ?? 0),
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
