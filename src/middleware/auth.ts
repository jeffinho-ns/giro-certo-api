import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { queryOne } from '../lib/db';
import { User } from '../types';

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

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    
    const user = await queryOne<User>(
      `SELECT id, name, email, "isSubscriber", "subscriptionType"
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
