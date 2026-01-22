import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { queryOne } from '../lib/db';
import { User, UserRole } from '../types';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

export interface AuthRequest extends Request {
  userId?: string;
  user?: any;
}

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      user?: any;
    }
  }
}

export async function authenticateToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ error: 'Token não fornecido' });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; role?: UserRole };
    
    const user = await queryOne<User>(
      `SELECT id, name, email, role, "isSubscriber", "subscriptionType"
       FROM "User" WHERE id = $1`,
      [decoded.userId]
    );

    if (!user) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    req.userId = decoded.userId;
    req.user = user;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Token inválido' });
  }
}

export function requirePremium(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.user?.isSubscriber || req.user?.subscriptionType !== 'premium') {
    return res.status(403).json({ error: 'Acesso restrito a assinantes Premium' });
  }
  next();
}

export function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.user || req.user.role !== UserRole.ADMIN) {
    return res.status(403).json({ error: 'Acesso restrito a administradores' });
  }
  next();
}

export function requireModerator(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.user || (req.user.role !== UserRole.ADMIN && req.user.role !== UserRole.MODERATOR)) {
    return res.status(403).json({ error: 'Acesso restrito a moderadores e administradores' });
  }
  next();
}
