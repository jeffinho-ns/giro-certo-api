import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { queryOne } from '../lib/db';

const router = Router();

// Canais de chat por comunidade (grupo). Por agora retorna lista vazia.
router.get('/:communityId/channels', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const hasTable = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Community') as exists`
    );
    if (!hasTable?.exists) {
      return res.json({ channels: [] });
    }
    res.json({ channels: [] });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
