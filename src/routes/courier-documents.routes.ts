import { Router, Request, Response } from 'express';
import { CourierDocumentService } from '../services/courier-document.service';
import { authenticateToken, AuthRequest, requireAdmin, requireModerator } from '../middleware/auth';
import { CreateCourierDocumentDto, UpdateDocumentStatusDto } from '../types';

const router = Router();
const documentService = new CourierDocumentService();

// Criar documento (entregador ou admin)
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const data: CreateCourierDocumentDto = {
      ...req.body,
      userId: req.body.userId || req.userId, // Se não especificado, usa o usuário autenticado
    };

    if (!data.userId) {
      return res.status(400).json({ error: 'userId é obrigatório' });
    }

    // Verificar se o usuário pode criar documento para este userId
    if (data.userId !== req.userId && req.user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Você não tem permissão para criar documentos para outros usuários' });
    }

    const document = await documentService.createDocument(data);
    res.status(201).json({ document });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Listar documentos de um entregador
router.get('/user/:userId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;

    // Verificar se o usuário pode ver documentos deste userId
    if (userId !== req.userId && req.user?.role !== 'ADMIN' && req.user?.role !== 'MODERATOR') {
      return res.status(403).json({ error: 'Você não tem permissão para ver documentos de outros usuários' });
    }

    const documents = await documentService.getDocumentsByUserId(userId);
    res.json({ documents });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Buscar documento por ID
router.get('/:documentId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const documentId = Array.isArray(req.params.documentId) ? req.params.documentId[0] : req.params.documentId;
    const document = await documentService.getDocumentById(documentId);

    if (!document) {
      return res.status(404).json({ error: 'Documento não encontrado' });
    }

    // Verificar se o usuário pode ver este documento
    const userId = (document as any).user?.id || (document as any).userId;
    if (userId !== req.userId && req.user?.role !== 'ADMIN' && req.user?.role !== 'MODERATOR') {
      return res.status(403).json({ error: 'Você não tem permissão para ver este documento' });
    }

    res.json({ document });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Listar documentos pendentes (admin/moderator)
router.get('/pending/review', authenticateToken, requireModerator, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const status = req.query.status as string | undefined;
    const documentType = req.query.documentType as string | undefined;

    const result = await documentService.getPendingDocuments(limit, offset, status, documentType);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Atualizar status do documento (aprovado/rejeitado) - apenas admin
router.put('/:documentId/status', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const documentId = Array.isArray(req.params.documentId) ? req.params.documentId[0] : req.params.documentId;
    const data: UpdateDocumentStatusDto = {
      ...req.body,
      verifiedBy: req.userId, // ID do admin que está aprovando/rejeitando
    };

    const document = await documentService.updateDocumentStatus(documentId, data);
    res.json({ document });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Deletar documento (apenas admin ou o próprio usuário)
router.delete('/:documentId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const documentId = Array.isArray(req.params.documentId) ? req.params.documentId[0] : req.params.documentId;
    
    // Verificar se o usuário pode deletar este documento
    const document = await documentService.getDocumentById(documentId);
    if (!document) {
      return res.status(404).json({ error: 'Documento não encontrado' });
    }

    const userId = (document as any).user?.id || (document as any).userId;
    if (userId !== req.userId && req.user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Você não tem permissão para deletar este documento' });
    }

    const result = await documentService.deleteDocument(documentId);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
