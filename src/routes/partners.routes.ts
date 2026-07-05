import { Router, Request, Response } from 'express';
import { PartnerService } from '../services/partner.service';
import { authenticateToken, AuthRequest, requireAdmin, requireModerator } from '../middleware/auth';
import { query, queryOne, execute } from '../lib/db';
import {
  CreatePartnerDto,
  UpdatePartnerDto,
  CreatePartnerPaymentDto,
  UpdatePartnerPaymentDto,
  RecordPaymentDto,
} from '../types';
import { DeliveryPaymentService } from '../services/delivery-payment.service';
import { assertPayoutProfileShape } from '../lib/payout-bank-account';
import { WHATSAPP_ORDER_TEMPLATE_PT } from '../constants/whatsapp-order-template';
import { isWhatsAppCloudConfigured } from '../services/whatsapp-cloud.service';

const router = Router();
const partnerService = new PartnerService();
const deliveryPaymentService = new DeliveryPaymentService();

// Listar parceiros (com filtros)
router.get('/', authenticateToken, async (req: Request, res: Response) => {
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

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
const WEEKDAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

/**
 * Extrai apenas campos operacionais seguros para o lojista.
 * Nunca permite isBlocked, CNPJ, payout, etc.
 */
function parseSafePartnerMeUpdate(body: unknown): UpdatePartnerDto {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Corpo inválido');
  }
  const raw = body as Record<string, unknown>;
  const data: UpdatePartnerDto = {};

  if (raw.phone !== undefined) {
    if (raw.phone !== null && typeof raw.phone !== 'string') {
      throw new Error('phone deve ser texto');
    }
    const phone = (raw.phone as string | null)?.trim();
    if (phone) data.phone = phone;
  }

  if (raw.avgPreparationTime !== undefined) {
    const n = Number(raw.avgPreparationTime);
    if (!Number.isFinite(n) || n < 0 || n > 24 * 60) {
      throw new Error('avgPreparationTime inválido (minutos)');
    }
    data.avgPreparationTime = Math.round(n);
  }

  if (raw.maxServiceRadius !== undefined) {
    const n = Number(raw.maxServiceRadius);
    if (!Number.isFinite(n) || n < 0 || n > 200) {
      throw new Error('maxServiceRadius inválido (km)');
    }
    data.maxServiceRadius = n;
  }

  if (raw.operatingHours !== undefined) {
    if (raw.operatingHours === null) {
      data.operatingHours = null;
    } else if (
      typeof raw.operatingHours !== 'object' ||
      Array.isArray(raw.operatingHours)
    ) {
      throw new Error('operatingHours inválido');
    } else {
      const hours = raw.operatingHours as Record<string, unknown>;
      const normalized: Record<string, { open?: string; close?: string; closed?: boolean }> =
        {};
      for (const day of WEEKDAY_KEYS) {
        const dayHours = hours[day];
        if (dayHours === undefined) continue;
        if (!dayHours || typeof dayHours !== 'object' || Array.isArray(dayHours)) {
          throw new Error(`operatingHours.${day} inválido`);
        }
        const d = dayHours as { open?: unknown; close?: unknown; closed?: unknown };
        if (d.closed === true) {
          normalized[day] = { closed: true };
          continue;
        }
        const open = typeof d.open === 'string' ? d.open.trim() : '';
        const close = typeof d.close === 'string' ? d.close.trim() : '';
        if (!TIME_RE.test(open) || !TIME_RE.test(close)) {
          throw new Error(
            `operatingHours.${day}: use horários HH:MM (ex.: 08:00–22:00) ou closed: true`
          );
        }
        normalized[day] = { open, close };
      }
      data.operatingHours = normalized;
    }
  }

  if (
    data.phone === undefined &&
    data.avgPreparationTime === undefined &&
    data.maxServiceRadius === undefined &&
    data.operatingHours === undefined
  ) {
    throw new Error(
      'Informe ao menos um campo: operatingHours, avgPreparationTime, maxServiceRadius ou phone'
    );
  }

  return data;
}

/** Atualizar configurações operacionais da própria loja (lojista). */
router.put('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const user = await queryOne<{ partnerId: string | null }>(
      'SELECT "partnerId" FROM "User" WHERE id = $1',
      [req.userId]
    );

    if (!user || !user.partnerId) {
      return res.status(404).json({ error: 'Você não está vinculado a nenhuma loja' });
    }

    const data = parseSafePartnerMeUpdate(req.body);
    const partner = await partnerService.updatePartner(user.partnerId, data);
    res.json({ partner });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/** Modelo de mensagem para o lojista enviar ao cliente no WhatsApp. */
router.get(
  '/me/whatsapp-order-template',
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    const apiPublic =
      process.env.API_PUBLIC_URL?.trim() ||
      'https://giro-certo-api.onrender.com';
    res.json({
      template: WHATSAPP_ORDER_TEMPLATE_PT,
      webhookUrl: `${apiPublic}/api/webhooks/whatsapp`,
      cloudConfigured: isWhatsAppCloudConfigured(),
      instructions: [
        '1. Configure WhatsApp Cloud API no Meta e aponte o webhook para webhookUrl.',
        '2. Cadastre o phone_number_id da loja (admin) e ative whatsapp_orders_enabled.',
        '3. No WhatsApp, envie o template ao cliente; quando ele responder no formato, o sistema cria o pedido e manda o link de pagamento.',
      ],
    });
  }
);

router.patch(
  '/me/delivery-payment-collection-mode',
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const userStore = await queryOne<{ partnerId: string | null }>(
        'SELECT "partnerId" FROM "User" WHERE id = $1',
        [req.userId]
      );
      if (!userStore?.partnerId) {
        return res.status(404).json({ error: 'Você não está vinculado a nenhuma loja' });
      }
      const mode = req.body?.mode as string | undefined;
      if (
        mode !== 'prepaid' &&
        mode !== 'postpaid_pix' &&
        mode !== 'authorize_capture'
      ) {
        return res.status(400).json({
          error:
            'mode obrigatório: prepaid | postpaid_pix | authorize_capture',
        });
      }
      await deliveryPaymentService.updatePartnerCollectionMode(
        userStore.partnerId,
        mode,
        req.user
      );
      res.json({ ok: true, delivery_payment_collection_mode: mode });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

/** Preferências de periodicidade da taxa de liquidação (agrupamento em lote). */
router.patch('/me/settlement-settings', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    const userStore = await queryOne<{ partnerId: string | null }>(
      'SELECT "partnerId" FROM "User" WHERE id = $1',
      [req.userId]
    );
    if (!userStore?.partnerId) {
      return res.status(404).json({ error: 'Você não está vinculado a nenhuma loja' });
    }

    const { frequency, fee_flat_override } = (req.body || {}) as {
      frequency?: string;
      fee_flat_override?: number | null;
    };

    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    if (frequency !== undefined) {
      if (
        typeof frequency !== 'string' ||
        !['daily', 'weekly', 'monthly'].includes(frequency)
      ) {
        return res.status(400).json({
          error: 'frequency deve ser daily | weekly | monthly',
        });
      }
      sets.push(`delivery_settlement_frequency = $${idx++}`);
      vals.push(frequency);
    }

    if (fee_flat_override !== undefined) {
      if (
        fee_flat_override !== null &&
        (typeof fee_flat_override !== 'number' ||
          !Number.isFinite(fee_flat_override) ||
          fee_flat_override < 0)
      ) {
        return res.status(400).json({
          error: 'fee_flat_override deve ser número >= 0 ou null para remover override',
        });
      }
      sets.push(`delivery_settlement_fee_flat_override = $${idx++}`);
      vals.push(fee_flat_override === null ? null : fee_flat_override);
    }

    if (sets.length === 0) {
      return res.status(400).json({
        error: 'Informe pelo menos frequency ou fee_flat_override',
      });
    }

    sets.push(`"updatedAt" = NOW()`);
    vals.push(userStore.partnerId);

    await execute(
      `UPDATE "Partner" SET ${sets.join(', ')} WHERE id = $${idx}`,
      vals
    );

    const row = await queryOne<{
      delivery_settlement_frequency: string;
      delivery_settlement_fee_flat_override: number | null;
    }>(
      `SELECT delivery_settlement_frequency, delivery_settlement_fee_flat_override
       FROM "Partner" WHERE id = $1`,
      [userStore.partnerId]
    );

    res.json({
      ok: true,
      delivery_settlement_frequency: row?.delivery_settlement_frequency ?? 'weekly',
      delivery_settlement_fee_flat_override:
        row?.delivery_settlement_fee_flat_override ?? null,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/** Conta beneficiária para repasse Asaas (`bankAccount`). GET devolve objeto salvo ou null. */
router.get('/me/payout-bank-profile', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
    const userStore = await queryOne<{ partnerId: string | null }>(
      'SELECT "partnerId" FROM "User" WHERE id = $1',
      [req.userId]
    );
    if (!userStore?.partnerId) {
      return res.status(404).json({ error: 'Você não está vinculado a nenhuma loja' });
    }
    const row = await queryOne<{ payout_bank_account_json: unknown }>(
      `SELECT payout_bank_account_json FROM "Partner" WHERE id = $1`,
      [userStore.partnerId]
    );
    const j = row?.payout_bank_account_json;
    const payout_bank_account =
      j != null && typeof j === 'object' && !Array.isArray(j)
        ? (j as Record<string, unknown>)
        : null;
    res.json({
      payout_bank_account,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.patch('/me/payout-bank-profile', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
    const userStore = await queryOne<{ partnerId: string | null }>(
      'SELECT "partnerId" FROM "User" WHERE id = $1',
      [req.userId]
    );
    if (!userStore?.partnerId) {
      return res.status(404).json({ error: 'Você não está vinculado a nenhuma loja' });
    }

    const body = req.body as { payout_bank_account?: unknown } | undefined;
    if (!body || !('payout_bank_account' in body)) {
      return res.status(400).json({ error: 'Body deve incluir payout_bank_account (objeto ou null para limpar)' });
    }

    const raw = body.payout_bank_account;
    let jsonbPayload: unknown = null;
    if (raw !== null) {
      const shaped = assertPayoutProfileShape(raw);
      jsonbPayload = shaped;
    }

    await execute(
      `UPDATE "Partner"
       SET payout_bank_account_json = $1::jsonb, "updatedAt" = NOW()
       WHERE id = $2`,
      [jsonbPayload === null ? null : JSON.stringify(jsonbPayload), userStore.partnerId]
    );

    const row = await queryOne<{ payout_bank_account_json: unknown }>(
      `SELECT payout_bank_account_json FROM "Partner" WHERE id = $1`,
      [userStore.partnerId]
    );
    const payout_bank_account =
      row?.payout_bank_account_json && typeof row.payout_bank_account_json === 'object'
        ? (row.payout_bank_account_json as Record<string, unknown>)
        : null;

    res.json({ ok: true, payout_bank_account });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Feed "Minha loja" — posts que mencionam a loja (hashtag ou conteúdo). Para lojista.
router.get('/:partnerId/feed', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const partnerId = Array.isArray(req.params.partnerId) ? req.params.partnerId[0] : req.params.partnerId;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 30, 50);
    const hasColumn = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Post' AND column_name = 'hashtags'
      ) as exists`
    );
    if (!hasColumn?.exists) {
      return res.json({ posts: [] });
    }
    const posts = await query<any>(
      `SELECT p.*, json_build_object('id', u.id, 'name', u.name, 'photoUrl', u."photoUrl", 'pilotProfile', u."pilotProfile") as user
       FROM "Post" p
       LEFT JOIN "User" u ON u.id = p."userId"
       WHERE p."hashtags" @> ARRAY[$2] OR p.content ILIKE $3
       ORDER BY p."createdAt" DESC
       LIMIT $1`,
      [limit, `partner_${partnerId}`, `%${partnerId}%`]
    );
    res.json({ posts: posts || [] });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/** Admin: vincula phone_number_id do Meta e ativa captura automática de pedidos. */
router.patch(
  '/:partnerId/whatsapp-settings',
  authenticateToken,
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const partnerId = Array.isArray(req.params.partnerId)
        ? req.params.partnerId[0]
        : req.params.partnerId;
      const { phone_number_id, enabled } = (req.body || {}) as {
        phone_number_id?: string | null;
        enabled?: boolean;
      };

      const sets: string[] = ['"updatedAt" = NOW()'];
      const params: unknown[] = [];
      let idx = 1;

      if (phone_number_id !== undefined) {
        sets.push(`whatsapp_phone_number_id = $${idx++}`);
        params.push(
          phone_number_id === null || phone_number_id === ''
            ? null
            : String(phone_number_id).trim()
        );
      }
      if (enabled !== undefined) {
        sets.push(`whatsapp_orders_enabled = $${idx++}`);
        params.push(Boolean(enabled));
      }

      if (params.length === 0) {
        return res.status(400).json({ error: 'Informe phone_number_id e/ou enabled' });
      }

      params.push(partnerId);
      await execute(
        `UPDATE "Partner" SET ${sets.join(', ')} WHERE id = $${idx}`,
        params
      );

      const row = await queryOne<{
        whatsapp_phone_number_id: string | null;
        whatsapp_orders_enabled: boolean;
      }>(
        `SELECT whatsapp_phone_number_id, whatsapp_orders_enabled FROM "Partner" WHERE id = $1`,
        [partnerId]
      );
      res.json({ ok: true, ...row });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// Buscar parceiro por ID
router.get('/:partnerId', authenticateToken, async (req: Request, res: Response) => {
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

// Excluir parceiro e usuários vinculados (apenas admin)
router.delete('/:partnerId', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const partnerId = Array.isArray(req.params.partnerId)
      ? req.params.partnerId[0]
      : req.params.partnerId;

    const partner = await partnerService.deletePartner(partnerId, req.userId);
    res.json({
      message: 'Parceiro e usuários vinculados excluídos com sucesso',
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
