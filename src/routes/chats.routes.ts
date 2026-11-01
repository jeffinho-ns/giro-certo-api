import { Router, Response } from 'express';
import multer, { MulterError } from 'multer';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { ChatHttpError, ChatIo, asRecord, parseFlag, parseUserId } from '../services/chat.types';
import {
  getSettings,
  hideConversation,
  listConversations,
  markRead,
  openPrivateChat,
  setArchived,
  setMuted,
  setPinned,
  startSupportChat,
} from '../services/chat.service';
import { blockUser, createReport, searchPeople, unblockUser } from '../services/chat-moderation.service';
import {
  createGroup,
  createInvite,
  joinByCode,
  openEventGroup,
  updateGroup,
  updateMeetup,
  updateMemberRole,
} from '../services/chat-groups.service';
import {
  CHAT_MEDIA_MAX_BYTES,
  deleteMessage,
  isAllowedChatMedia,
  listMessages,
  sendMessage,
  storeChatMedia,
  UploadedChatFile,
} from '../services/chat-messages.service';

const router = Router();

router.use(authenticateToken);

const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CHAT_MEDIA_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (isAllowedChatMedia(file.mimetype)) cb(null, true);
    else cb(new Error('Tipo de ficheiro não suportado'));
  },
});

const getParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] || '' : value || '';

function queryValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

function currentUserId(req: AuthRequest): string {
  if (!req.userId) throw new ChatHttpError(401, 'Não autenticado');
  return req.userId;
}

function getIo(req: AuthRequest): ChatIo | null {
  const io: unknown = req.app.get('io');
  if (!io || typeof io !== 'object' || !('to' in io)) return null;
  const to = (io as { to?: unknown }).to;
  if (typeof to !== 'function') return null;
  return io as ChatIo;
}

function sendError(res: Response, error: unknown): void {
  if (!(error instanceof ChatHttpError)) console.error('[chats]', error);
  const status = error instanceof ChatHttpError ? error.status : 400;
  const message = error instanceof Error && error.message ? error.message : 'Erro interno';
  res.status(status).json({ error: message });
}

function run(handler: (req: AuthRequest, res: Response) => Promise<void>) {
  return (req: AuthRequest, res: Response) => {
    handler(req, res).catch((error: unknown) => sendError(res, error));
  };
}

function listType(value: unknown): 'private' | 'group' | 'all' {
  const raw = queryValue(value);
  if (!raw) return 'all';
  if (raw === 'private' || raw === 'group') return raw;
  throw new ChatHttpError(400, 'type inválido');
}

router.get(
  '/people',
  run(async (req, res) => {
    const people = await searchPeople(currentUserId(req), queryValue(req.query.q));
    res.json({ people });
  })
);

router.post(
  '/private',
  run(async (req, res) => {
    const recipientId = parseUserId(asRecord(req.body).recipientId, 'recipientId');
    const result = await openPrivateChat(currentUserId(req), recipientId);
    res.status(result.created ? 201 : 200).json({ conversation: result.conversation });
  })
);

router.post(
  '/support/start',
  run(async (req, res) => {
    const result = await startSupportChat(currentUserId(req));
    res.json(result);
  })
);

router.post(
  '/groups',
  run(async (req, res) => {
    const conversation = await createGroup(currentUserId(req), req.body);
    res.status(201).json({ conversation });
  })
);

router.post(
  '/from-event',
  run(async (req, res) => {
    const result = await openEventGroup(currentUserId(req), req.body);
    res.status(result.created ? 201 : 200).json({ conversation: result.conversation });
  })
);

router.post(
  '/join',
  run(async (req, res) => {
    const conversation = await joinByCode(currentUserId(req), req.body);
    res.json({ conversation });
  })
);

router.post(
  '/blocks',
  run(async (req, res) => {
    await blockUser(currentUserId(req), asRecord(req.body).userId);
    res.status(201).json({ blocked: true });
  })
);

router.delete(
  '/blocks/:userId',
  run(async (req, res) => {
    await unblockUser(currentUserId(req), getParam(req.params.userId));
    res.json({ blocked: false });
  })
);

router.post(
  '/reports',
  run(async (req, res) => {
    const report = await createReport(currentUserId(req), req.body);
    res.status(201).json(report);
  })
);

router.post('/media', (req: AuthRequest, res: Response) => {
  chatUpload.single('file')(req, res, (err: unknown) => {
    if (err) {
      const tooBig = err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE';
      const message = tooBig
        ? 'Ficheiro demasiado grande (máx. 15MB).'
        : err instanceof Error
          ? err.message
          : 'Upload inválido';
      res.status(tooBig ? 413 : 400).json({ error: message });
      return;
    }
    void (async () => {
      try {
        const file = (req as AuthRequest & { file?: UploadedChatFile }).file;
        if (!file) {
          res.status(400).json({ error: 'Nenhum ficheiro enviado' });
          return;
        }
        const url = await storeChatMedia(file);
        res.json({ url });
      } catch (error: unknown) {
        sendError(res, error);
      }
    })();
  });
});

router.get(
  '/',
  run(async (req, res) => {
    const conversations = await listConversations(
      currentUserId(req),
      listType(req.query.type),
      req.query.archived === 'true'
    );
    res.json({ conversations });
  })
);

router.get(
  '/:chatId/settings',
  run(async (req, res) => {
    const settings = await getSettings(
      currentUserId(req),
      getParam(req.params.chatId),
      getIo(req)
    );
    res.json(settings);
  })
);

router.get(
  '/:chatId/messages',
  run(async (req, res) => {
    const result = await listMessages(currentUserId(req), getParam(req.params.chatId));
    res.json(result);
  })
);

router.post(
  '/:chatId/messages',
  run(async (req, res) => {
    const message = await sendMessage(
      currentUserId(req),
      getParam(req.params.chatId),
      req.body,
      getIo(req)
    );
    res.status(201).json({ message });
  })
);

router.delete(
  '/:chatId/messages/:messageId',
  run(async (req, res) => {
    await deleteMessage(
      currentUserId(req),
      getParam(req.params.chatId),
      getParam(req.params.messageId),
      getIo(req)
    );
    res.json({ ok: true });
  })
);

router.put(
  '/:chatId/mute',
  run(async (req, res) => {
    const muted = await setMuted(
      currentUserId(req),
      getParam(req.params.chatId),
      parseFlag(req.body, 'muted')
    );
    res.json({ muted });
  })
);

router.put(
  '/:chatId/read',
  run(async (req, res) => {
    const lastReadAt = await markRead(currentUserId(req), getParam(req.params.chatId), getIo(req));
    res.json({ lastReadAt });
  })
);

router.put(
  '/:chatId/pin',
  run(async (req, res) => {
    const pinned = await setPinned(
      currentUserId(req),
      getParam(req.params.chatId),
      parseFlag(req.body, 'pinned')
    );
    res.json({ pinned });
  })
);

router.put(
  '/:chatId/archive',
  run(async (req, res) => {
    const archived = await setArchived(
      currentUserId(req),
      getParam(req.params.chatId),
      parseFlag(req.body, 'archived')
    );
    res.json({ archived });
  })
);

router.patch(
  '/:chatId',
  run(async (req, res) => {
    const conversation = await updateGroup(currentUserId(req), getParam(req.params.chatId), req.body);
    res.json({ conversation });
  })
);

router.put(
  '/:chatId/meetup',
  run(async (req, res) => {
    const result = await updateMeetup(
      currentUserId(req),
      getParam(req.params.chatId),
      req.body,
      getIo(req)
    );
    res.json(result);
  })
);

router.put(
  '/:chatId/members/:userId',
  run(async (req, res) => {
    const result = await updateMemberRole(
      currentUserId(req),
      getParam(req.params.chatId),
      getParam(req.params.userId),
      req.body,
      getIo(req)
    );
    res.json(result);
  })
);

router.post(
  '/:chatId/invites',
  run(async (req, res) => {
    const invite = await createInvite(currentUserId(req), getParam(req.params.chatId));
    res.status(201).json(invite);
  })
);

router.delete(
  '/:chatId',
  run(async (req, res) => {
    await hideConversation(currentUserId(req), getParam(req.params.chatId));
    res.json({ message: 'Conversa excluída para o utilizador atual.' });
  })
);

export default router;
