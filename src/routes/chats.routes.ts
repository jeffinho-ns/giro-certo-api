import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { query, queryOne } from '../lib/db';
import { generateId } from '../utils/id';
import { sendPushToUser } from '../services/fcm.service';

const router = Router();

const getParam = (v: string | string[] | undefined): string =>
  Array.isArray(v) ? v[0] || '' : v || '';

// Listar conversas privadas do utilizador
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const hasTable = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ChatConversation') as exists`
    );
    if (!hasTable?.exists) return res.json({ conversations: [] });

    const userId = req.userId!;
    const rows = await query<{
      id: string;
      participant1Id: string;
      participant2Id: string;
      lastMessageAt: Date | null;
      lastMessagePreview: string | null;
      otherId: string;
      otherName: string;
      otherPhotoUrl: string | null;
    }>(
      `SELECT c.id, c."participant1Id", c."participant2Id", c."lastMessageAt", c."lastMessagePreview",
              CASE WHEN c."participant1Id" = $1 THEN c."participant2Id" ELSE c."participant1Id" END as "otherId",
              u.name as "otherName", u."photoUrl" as "otherPhotoUrl"
       FROM "ChatConversation" c
       JOIN "User" u ON u.id = CASE WHEN c."participant1Id" = $1 THEN c."participant2Id" ELSE c."participant1Id" END
       WHERE c."participant1Id" = $1 OR c."participant2Id" = $1
       ORDER BY c."lastMessageAt" DESC NULLS LAST`,
      [userId]
    );

    const conversations = rows.map((r) => ({
      id: r.id,
      title: r.otherName,
      lastMessagePreview: r.lastMessagePreview ?? '',
      lastMessageAt: r.lastMessageAt,
      isGroup: false,
      imageUrlOrUserId: r.otherId,
    }));

    res.json({ conversations });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Obter ou criar conversa privada entre dois utilizadores
router.post('/private', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const hasTable = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ChatConversation') as exists`
    );
    if (!hasTable?.exists) {
      return res.status(501).json({ error: 'Tabela ChatConversation não existe. Execute migrate-chat.sql' });
    }

    const currentUserId = req.userId!;
    const { recipientId } = req.body as { recipientId?: string };
    if (!recipientId || recipientId === currentUserId) {
      return res.status(400).json({ error: 'recipientId inválido' });
    }

    const [p1, p2] = [currentUserId, recipientId].sort();
    let conv = await queryOne<{
      id: string;
      lastMessageAt: Date | null;
      lastMessagePreview: string | null;
    }>(
      `SELECT id, "lastMessageAt", "lastMessagePreview" FROM "ChatConversation"
       WHERE "participant1Id" = $1 AND "participant2Id" = $2`,
      [p1, p2]
    );

    if (conv) {
      const other = await queryOne<{ name: string }>(
        'SELECT name FROM "User" WHERE id = $1',
        [p1 === currentUserId ? p2 : p1]
      );
      return res.json({
        conversation: {
          id: conv.id,
          title: other?.name ?? 'Utilizador',
          lastMessagePreview: conv.lastMessagePreview ?? '',
          lastMessageAt: conv.lastMessageAt,
          isGroup: false,
          imageUrlOrUserId: recipientId,
        },
      });
    }

    const chatId = generateId();
    await query(
      `INSERT INTO "ChatConversation" (id, "participant1Id", "participant2Id", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [chatId, p1, p2]
    );

    const other = await queryOne<{ name: string }>(
      'SELECT name FROM "User" WHERE id = $1',
      [recipientId]
    );

    res.status(201).json({
      conversation: {
        id: chatId,
        title: other?.name ?? 'Utilizador',
        lastMessagePreview: '',
        lastMessageAt: null,
        isGroup: false,
        imageUrlOrUserId: recipientId,
      },
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Listar mensagens de uma conversa
router.get('/:chatId/messages', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const chatId = getParam(req.params.chatId);
    const currentUserId = req.userId!;

    const conv = await queryOne<{ participant1Id: string; participant2Id: string }>(
      'SELECT "participant1Id", "participant2Id" FROM "ChatConversation" WHERE id = $1',
      [chatId]
    );
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
    if (conv.participant1Id !== currentUserId && conv.participant2Id !== currentUserId) {
      return res.status(403).json({ error: 'Sem acesso a esta conversa' });
    }

    const rows = await query<{
      id: string;
      senderId: string;
      text: string;
      createdAt: Date;
    }>(
      `SELECT m.id, m."senderId", m.text, m."createdAt"
       FROM "ChatMessage" m
       WHERE m."chatId" = $1
       ORDER BY m."createdAt" ASC`,
      [chatId]
    );

    const senders = await query<{ id: string; name: string }>(
      `SELECT id, name FROM "User" WHERE id = ANY($1)`,
      [rows.length ? [...new Set(rows.map((r) => r.senderId))] : []]
    );
    const senderMap = Object.fromEntries(senders.map((s) => [s.id, s.name]));

    const messages = rows.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      senderName: senderMap[m.senderId] ?? 'Utilizador',
      text: m.text,
      createdAt: m.createdAt,
      isFromMe: m.senderId === currentUserId,
    }));

    res.json({ messages });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Enviar mensagem
router.post('/:chatId/messages', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const chatId = getParam(req.params.chatId);
    const currentUserId = req.userId!;
    const { text } = req.body as { text?: string };
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text é obrigatório' });
    }

    const conv = await queryOne<{ participant1Id: string; participant2Id: string }>(
      'SELECT "participant1Id", "participant2Id" FROM "ChatConversation" WHERE id = $1',
      [chatId]
    );
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
    if (conv.participant1Id !== currentUserId && conv.participant2Id !== currentUserId) {
      return res.status(403).json({ error: 'Sem acesso a esta conversa' });
    }

    const msgId = generateId();
    const preview = text.trim().slice(0, 80) + (text.trim().length > 80 ? '...' : '');

    await query(
      `INSERT INTO "ChatMessage" (id, "chatId", "senderId", text, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [msgId, chatId, currentUserId, text.trim()]
    );

    await query(
      `UPDATE "ChatConversation" SET "lastMessageAt" = NOW(), "lastMessagePreview" = $2, "updatedAt" = NOW() WHERE id = $1`,
      [chatId, preview]
    );

    const user = await queryOne<{ name: string }>(
      'SELECT name FROM "User" WHERE id = $1',
      [currentUserId]
    );

    const message = {
      id: msgId,
      senderId: currentUserId,
      senderName: user?.name ?? 'Utilizador',
      text: text.trim(),
      createdAt: new Date(),
      isFromMe: true,
    };

    const otherUserId = conv.participant1Id === currentUserId ? conv.participant2Id : conv.participant1Id;
    const io = (req as any).app?.get?.('io');
    if (io?.to) {
      const payload = {
        chatId,
        message: {
          id: msgId,
          senderId: currentUserId,
          senderName: user?.name ?? 'Utilizador',
          text: text.trim(),
          createdAt: (message.createdAt as Date).toISOString(),
          isFromMe: false,
        },
      };
      io.to(`user:${otherUserId}`).emit('chat:message', payload);
    }
    const pushPreview = (user?.name ?? 'Alguém') + ': ' + text.trim().slice(0, 60) + (text.trim().length > 60 ? '...' : '');
    await sendPushToUser(otherUserId, 'Nova mensagem', pushPreview, { type: 'chat', chatId });

    res.status(201).json({ message });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
