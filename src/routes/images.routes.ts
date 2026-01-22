import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { ImageService } from '../services/image.service';
import { ImageEntityType } from '../types';
import multer from 'multer';

const router = Router();
const imageService = new ImageService();

// Configurar multer para processar uploads em memória
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    // Aceitar apenas imagens
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos de imagem são permitidos'));
    }
  },
});

// Upload de imagem
router.post(
  '/upload/:entityType/:entityId',
  authenticateToken,
  upload.single('image'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Nenhuma imagem fornecida' });
      }

      const entityType = (Array.isArray(req.params.entityType) ? req.params.entityType[0] : req.params.entityType) as ImageEntityType;
      const entityId = Array.isArray(req.params.entityId) ? req.params.entityId[0] : req.params.entityId;
      const isPrimary = req.body.isPrimary === 'true' || req.body.isPrimary === true;

      // Validar entityType
      if (!Object.values(ImageEntityType).includes(entityType)) {
        return res.status(400).json({ error: 'Tipo de entidade inválido' });
      }

      // Verificar permissões (usuário só pode fazer upload para suas próprias entidades)
      if (entityType === ImageEntityType.USER && entityId !== req.userId) {
        return res.status(403).json({ error: 'Sem permissão para fazer upload' });
      }

      const image = await imageService.uploadImage(entityType, entityId, req.file, isPrimary);

      res.status(201).json({
        image: {
          id: image.id,
          entityType: image.entityType,
          entityId: image.entityId,
          filename: image.filename,
          mimetype: image.mimetype,
          size: image.size,
          isPrimary: image.isPrimary,
          url: `/api/images/${image.id}`,
          createdAt: image.createdAt,
        },
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// Buscar imagem por ID (retorna os dados binários)
router.get('/:imageId', async (req: AuthRequest, res: Response) => {
  try {
    const imageId = Array.isArray(req.params.imageId) ? req.params.imageId[0] : req.params.imageId;

    const image = await imageService.getImageById(imageId);

    if (!image) {
      return res.status(404).json({ error: 'Imagem não encontrada' });
    }

    // Definir headers apropriados
    res.setHeader('Content-Type', image.mimetype);
    res.setHeader('Content-Length', image.size);
    res.setHeader('Content-Disposition', `inline; filename="${image.filename}"`);

    // Enviar dados binários
    res.send(image.data);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Listar imagens de uma entidade
router.get('/entity/:entityType/:entityId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const entityType = (Array.isArray(req.params.entityType) ? req.params.entityType[0] : req.params.entityType) as ImageEntityType;
    const entityId = Array.isArray(req.params.entityId) ? req.params.entityId[0] : req.params.entityId;

    if (!Object.values(ImageEntityType).includes(entityType)) {
      return res.status(400).json({ error: 'Tipo de entidade inválido' });
    }

    const images = await imageService.getImagesByEntity(entityType, entityId);

    res.json({
      images: images.map((img) => ({
        id: img.id,
        entityType: img.entityType,
        entityId: img.entityId,
        filename: img.filename,
        mimetype: img.mimetype,
        size: img.size,
        isPrimary: img.isPrimary,
        url: `/api/images/${img.id}`,
        createdAt: img.createdAt,
      })),
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Deletar imagem
router.delete('/:imageId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const imageId = Array.isArray(req.params.imageId) ? req.params.imageId[0] : req.params.imageId;

    const image = await imageService.getImageById(imageId);

    if (!image) {
      return res.status(404).json({ error: 'Imagem não encontrada' });
    }

    // Verificar permissões
    if (image.entityType === ImageEntityType.USER && image.entityId !== req.userId) {
      return res.status(403).json({ error: 'Sem permissão para deletar esta imagem' });
    }

    await imageService.deleteImage(imageId);

    res.json({ message: 'Imagem deletada com sucesso' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Definir imagem como primária
router.patch('/:imageId/primary', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const imageId = Array.isArray(req.params.imageId) ? req.params.imageId[0] : req.params.imageId;

    const image = await imageService.getImageById(imageId);

    if (!image) {
      return res.status(404).json({ error: 'Imagem não encontrada' });
    }

    // Verificar permissões
    if (image.entityType === ImageEntityType.USER && image.entityId !== req.userId) {
      return res.status(403).json({ error: 'Sem permissão para alterar esta imagem' });
    }

    await imageService.setPrimaryImage(imageId, image.entityType, image.entityId);

    res.json({ message: 'Imagem definida como primária' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
