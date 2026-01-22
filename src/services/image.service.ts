import { query, queryOne, transaction } from '../lib/db';
import { Image, ImageEntityType } from '../types';
import { generateId } from '../utils/id';

export class ImageService {
  /**
   * Upload de imagem
   */
  async uploadImage(
    entityType: ImageEntityType,
    entityId: string,
    file: Express.Multer.File,
    isPrimary: boolean = false
  ): Promise<Image> {
    const imageId = generateId();

    // Se for primária, desmarcar outras como primárias
    if (isPrimary) {
      await query(
        `UPDATE "Image" 
         SET "isPrimary" = false, "updatedAt" = NOW()
         WHERE "entityType" = $1 AND "entityId" = $2 AND "isPrimary" = true`,
        [entityType, entityId]
      );
    }

    // Inserir nova imagem
    await query(
      `INSERT INTO "Image" (
        id, "entityType", "entityId", filename, mimetype, size, 
        data, "isPrimary", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
      [
        imageId,
        entityType,
        entityId,
        file.originalname,
        file.mimetype,
        file.size,
        file.buffer,
        isPrimary,
      ]
    );

    const image = await queryOne<Image>(
      'SELECT id, "entityType", "entityId", filename, mimetype, size, "isPrimary", "createdAt", "updatedAt" FROM "Image" WHERE id = $1',
      [imageId]
    );

    if (!image) {
      throw new Error('Erro ao criar imagem');
    }

    return image;
  }

  /**
   * Buscar imagem por ID
   */
  async getImageById(imageId: string): Promise<Image | null> {
    return await queryOne<Image>(
      'SELECT * FROM "Image" WHERE id = $1',
      [imageId]
    );
  }

  /**
   * Buscar imagens de uma entidade
   */
  async getImagesByEntity(
    entityType: ImageEntityType,
    entityId: string
  ): Promise<Image[]> {
    return await query<Image>(
      `SELECT id, "entityType", "entityId", filename, mimetype, size, 
              "isPrimary", "createdAt", "updatedAt"
       FROM "Image" 
       WHERE "entityType" = $1 AND "entityId" = $2 
       ORDER BY "isPrimary" DESC, "createdAt" DESC`,
      [entityType, entityId]
    );
  }

  /**
   * Buscar imagem primária de uma entidade
   */
  async getPrimaryImage(
    entityType: ImageEntityType,
    entityId: string
  ): Promise<Image | null> {
    return await queryOne<Image>(
      `SELECT * FROM "Image" 
       WHERE "entityType" = $1 AND "entityId" = $2 AND "isPrimary" = true 
       LIMIT 1`,
      [entityType, entityId]
    );
  }

  /**
   * Deletar imagem
   */
  async deleteImage(imageId: string): Promise<void> {
    await query('DELETE FROM "Image" WHERE id = $1', [imageId]);
  }

  /**
   * Deletar todas as imagens de uma entidade
   */
  async deleteImagesByEntity(
    entityType: ImageEntityType,
    entityId: string
  ): Promise<void> {
    await query(
      'DELETE FROM "Image" WHERE "entityType" = $1 AND "entityId" = $2',
      [entityType, entityId]
    );
  }

  /**
   * Definir imagem como primária
   */
  async setPrimaryImage(imageId: string, entityType: ImageEntityType, entityId: string): Promise<void> {
    await transaction(async (client) => {
      // Desmarcar outras como primárias
      await client.query(
        `UPDATE "Image" 
         SET "isPrimary" = false, "updatedAt" = NOW()
         WHERE "entityType" = $1 AND "entityId" = $2 AND "isPrimary" = true`,
        [entityType, entityId]
      );

      // Marcar esta como primária
      await client.query(
        `UPDATE "Image" 
         SET "isPrimary" = true, "updatedAt" = NOW()
         WHERE id = $3`,
        [entityType, entityId, imageId]
      );
    });
  }
}
