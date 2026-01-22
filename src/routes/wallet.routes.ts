import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { query, queryOne, transaction } from '../lib/db';
import { Wallet, TransactionType, TransactionStatus } from '../types';
import { generateId } from '../utils/id';

const router = Router();

// Buscar wallet do usuário
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const wallet = await queryOne<Wallet & { transactions: any[] }>(
      `SELECT 
        w.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', wt.id,
              'type', wt.type,
              'amount', wt.amount,
              'description', wt.description,
              'status', wt.status,
              'createdAt', wt."createdAt"
            ) ORDER BY wt."createdAt" DESC
          ) FILTER (WHERE wt.id IS NOT NULL),
          '[]'::json
        ) as transactions
       FROM "Wallet" w
       LEFT JOIN "WalletTransaction" wt ON wt."walletId" = w.id
       WHERE w."userId" = $1
       GROUP BY w.id
       LIMIT 50`,
      [req.userId]
    );

    if (!wallet) {
      return res.status(404).json({ error: 'Wallet não encontrada' });
    }

    res.json({ wallet });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Criar solicitação de saque
router.post('/withdraw', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valor inválido' });
    }

    const wallet = await queryOne<Wallet>(
      'SELECT * FROM "Wallet" WHERE "userId" = $1',
      [req.userId]
    );

    if (!wallet) {
      return res.status(404).json({ error: 'Wallet não encontrada' });
    }

    if (wallet.balance < amount) {
      return res.status(400).json({ error: 'Saldo insuficiente' });
    }

    const transactionId = generateId();

    await transaction(async (client) => {
      await client.query(
        `INSERT INTO "WalletTransaction" (
          id, "walletId", "userId", type, amount, description, status, "createdAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          transactionId,
          wallet.id,
          req.userId,
          TransactionType.WITHDRAWAL,
          amount,
          `Solicitação de saque de R$ ${amount.toFixed(2)}`,
          TransactionStatus.pending,
        ]
      );

      await client.query(
        'UPDATE "Wallet" SET balance = balance - $1, "updatedAt" = NOW() WHERE id = $2',
        [amount, wallet.id]
      );
    });

    const walletTransaction = await queryOne(
      'SELECT * FROM "WalletTransaction" WHERE id = $1',
      [transactionId]
    );

    res.status(201).json({ transaction: walletTransaction });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Listar transações
router.get('/me/transactions', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const wallet = await queryOne<Wallet>(
      'SELECT * FROM "Wallet" WHERE "userId" = $1',
      [req.userId]
    );

    if (!wallet) {
      return res.status(404).json({ error: 'Wallet não encontrada' });
    }

    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const transactions = await query(
      `SELECT * FROM "WalletTransaction" 
       WHERE "walletId" = $1 
       ORDER BY "createdAt" DESC 
       LIMIT $2 OFFSET $3`,
      [wallet.id, limit, offset]
    );

    res.json({ transactions });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
