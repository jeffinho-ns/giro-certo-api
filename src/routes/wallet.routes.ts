import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '@/middleware/auth';
import prisma from '@/lib/prisma';

const router = Router();

// Buscar wallet do usuário
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const wallet = await prisma.wallet.findUnique({
      where: { userId: req.userId },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

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

    // Buscar wallet
    const wallet = await prisma.wallet.findUnique({
      where: { userId: req.userId },
    });

    if (!wallet) {
      return res.status(404).json({ error: 'Wallet não encontrada' });
    }

    if (wallet.balance < amount) {
      return res.status(400).json({ error: 'Saldo insuficiente' });
    }

    // Criar transação de saque
    const transaction = await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        userId: req.userId,
        type: 'WITHDRAWAL',
        amount: amount,
        description: `Solicitação de saque de R$ ${amount.toFixed(2)}`,
        status: 'pending',
      },
    });

    // Atualizar saldo (bloquear o valor)
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { decrement: amount },
      },
    });

    res.status(201).json({ transaction });
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

    const wallet = await prisma.wallet.findUnique({
      where: { userId: req.userId },
    });

    if (!wallet) {
      return res.status(404).json({ error: 'Wallet não encontrada' });
    }

    const transactions = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: parseInt(req.query.limit as string) || 50,
      skip: parseInt(req.query.offset as string) || 0,
    });

    res.json({ transactions });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
