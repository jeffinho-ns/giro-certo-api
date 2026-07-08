import { Response, NextFunction } from 'express';
import { queryOne } from '../lib/db';
import { AuthRequest } from './auth';
import { UserRole } from '../types';

declare module 'express-serve-static-core' {
  interface Request {
    actAsPartnerId?: string;
    adminActAs?: boolean;
  }
}

function headerPartnerId(req: AuthRequest): string | null {
  const raw = req.headers['x-act-as-partner'];
  if (!raw) return null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() || null;
}

function isStaff(user: { role?: UserRole }): boolean {
  return user.role === UserRole.ADMIN || user.role === UserRole.MODERATOR;
}

/**
 * Autoriza gestão de loja: lojista com partnerId OU admin/moderador com header X-Act-As-Partner.
 */
export function requireStoreManageAccess(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.user) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  if (req.user.partnerId) {
    return next();
  }

  const actAs = headerPartnerId(req);
  if (isStaff(req.user) && actAs) {
    req.actAsPartnerId = actAs;
    req.adminActAs = true;
    return next();
  }

  return res.status(403).json({
    error: 'Acesso restrito a lojistas ou equipe com header X-Act-As-Partner',
  });
}

/**
 * Define actAsPartnerId a partir de :partnerId na rota admin espelhada.
 */
export function setActAsPartnerFromParam(paramName = 'partnerId') {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const raw = req.params[paramName];
    const partnerId = Array.isArray(raw) ? raw[0] : raw;
    if (!partnerId?.trim()) {
      return res.status(400).json({ error: 'partnerId obrigatório' });
    }
    req.actAsPartnerId = partnerId.trim();
    req.adminActAs = true;
    next();
  };
}

/**
 * Bloqueia alterações de marketing quando a loja está em modo giro_managed.
 * Admin em modo act-as não é bloqueado.
 */
export async function blockManagedMarketingWrites(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    if (req.adminActAs) {
      return next();
    }

    const partnerId = req.actAsPartnerId || req.user?.partnerId;
    if (!partnerId) {
      return res.status(403).json({ error: 'Loja não identificada' });
    }

    const row = await queryOne<{ storeManagementMode: string }>(
      `SELECT "storeManagementMode" FROM "Partner" WHERE id = $1`,
      [partnerId]
    );

    if (row?.storeManagementMode === 'giro_managed') {
      return res.status(403).json({
        error:
          'O marketing desta loja é gerenciado pelo time Giro Certo. Entre em contato com o suporte para solicitar alterações.',
      });
    }

    next();
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao validar permissões' });
  }
}
