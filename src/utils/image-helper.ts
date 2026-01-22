import { ImageService } from '../services/image.service';
import { ImageEntityType } from '../types';

const imageService = new ImageService();

/**
 * Helper para obter URL da imagem primária de uma entidade
 */
export async function getImageUrl(
  entityType: ImageEntityType,
  entityId: string | null | undefined
): Promise<string | null> {
  if (!entityId) return null;

  try {
    const image = await imageService.getPrimaryImage(entityType, entityId);
    return image ? `/api/images/${image.id}` : null;
  } catch {
    return null;
  }
}

/**
 * Helper para obter URLs de todas as imagens de uma entidade
 */
export async function getImageUrls(
  entityType: ImageEntityType,
  entityId: string | null | undefined
): Promise<string[]> {
  if (!entityId) return [];

  try {
    const images = await imageService.getImagesByEntity(entityType, entityId);
    return images.map((img) => `/api/images/${img.id}`);
  } catch {
    return [];
  }
}

/**
 * Helper para adicionar URL de imagem a um objeto
 */
export async function addImageUrlToEntity<T extends { id: string; photoUrl?: string | null }>(
  entity: T,
  entityType: ImageEntityType
): Promise<T & { imageUrl: string | null }> {
  const imageUrl = await getImageUrl(entityType, entity.id);
  return {
    ...entity,
    imageUrl: imageUrl || entity.photoUrl || null,
  };
}

/**
 * Helper para adicionar URLs de imagens a uma lista de entidades
 */
export async function addImageUrlsToEntities<T extends { id: string; photoUrl?: string | null }>(
  entities: T[],
  entityType: ImageEntityType
): Promise<Array<T & { imageUrl: string | null }>> {
  return Promise.all(
    entities.map((entity) => addImageUrlToEntity(entity, entityType))
  );
}
