import { query, queryOne, transaction } from '../lib/db';
import {
  CreateCourierDocumentDto,
  UpdateDocumentStatusDto,
  CourierDocument,
  DocumentStatus,
  DocumentType,
  User,
} from '../types';
import { generateId } from '../utils/id';

export class CourierDocumentService {
  /**
   * Criar um novo documento de entregador
   */
  async createDocument(data: CreateCourierDocumentDto) {
    // Verificar se o usuário existe
    const user = await queryOne<User>(
      'SELECT id FROM "User" WHERE id = $1',
      [data.userId]
    );

    if (!user) {
      throw new Error('Usuário não encontrado');
    }

    const documentId = generateId();

    await query(
      `INSERT INTO "CourierDocument" (
        id, "userId", "documentType", status, "fileUrl", "expirationDate",
        "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [
        documentId,
        data.userId,
        data.documentType,
        DocumentStatus.UPLOADED,
        data.fileUrl,
        data.expirationDate || null,
      ]
    );

    const document = await queryOne<CourierDocument>(
      'SELECT * FROM "CourierDocument" WHERE id = $1',
      [documentId]
    );

    return document;
  }

  /**
   * Listar documentos de um entregador
   */
  async getDocumentsByUserId(userId: string) {
    const documents = await query<CourierDocument>(
      `SELECT * FROM "CourierDocument" 
       WHERE "userId" = $1 
       ORDER BY "createdAt" DESC`,
      [userId]
    );

    return documents;
  }

  /**
   * Buscar documento por ID
   */
  async getDocumentById(documentId: string) {
    const document = await queryOne<CourierDocument>(
      `SELECT cd.*, 
              json_build_object(
                'id', u.id,
                'name', u.name,
                'email', u.email
              ) as user
       FROM "CourierDocument" cd
       JOIN "User" u ON u.id = cd."userId"
       WHERE cd.id = $1`,
      [documentId]
    );

    return document;
  }

  /**
   * Atualizar status do documento (aprovado/rejeitado pelo admin)
   */
  async updateDocumentStatus(
    documentId: string,
    data: UpdateDocumentStatusDto
  ) {
    const document = await queryOne<CourierDocument>(
      'SELECT * FROM "CourierDocument" WHERE id = $1',
      [documentId]
    );

    if (!document) {
      throw new Error('Documento não encontrado');
    }

    const updateFields: string[] = ['status = $1', '"updatedAt" = NOW()'];
    const params: any[] = [data.status];

    if (data.status === DocumentStatus.APPROVED) {
      updateFields.push('"verifiedAt" = NOW()');
      if (data.verifiedBy) {
        updateFields.push('"verifiedBy" = $' + (params.length + 1));
        params.push(data.verifiedBy);
      }
    }

    if (data.status === DocumentStatus.REJECTED && data.rejectionReason) {
      updateFields.push('"rejectionReason" = $' + (params.length + 1));
      params.push(data.rejectionReason);
    }

    if (data.notes) {
      updateFields.push('notes = $' + (params.length + 1));
      params.push(data.notes);
    }

    params.push(documentId);

    await query(
      `UPDATE "CourierDocument" 
       SET ${updateFields.join(', ')}
       WHERE id = $${params.length}`,
      params
    );

    // Se foi aprovado, verificar se todos os documentos necessários estão aprovados
    if (data.status === DocumentStatus.APPROVED) {
      await this.checkAndUpdateUserVerification(document.userId);
    }

    const updatedDocument = await queryOne<CourierDocument>(
      'SELECT * FROM "CourierDocument" WHERE id = $1',
      [documentId]
    );

    return updatedDocument;
  }

  /**
   * Verificar se todos os documentos necessários estão aprovados
   * e atualizar status de verificação do usuário
   */
  private async checkAndUpdateUserVerification(userId: string) {
    // Buscar todos os documentos do usuário
    const documents = await query<CourierDocument>(
      `SELECT * FROM "CourierDocument" 
       WHERE "userId" = $1 
       AND status = $2`,
      [userId, DocumentStatus.APPROVED]
    );

    // Verificar se tem pelo menos um documento de cada tipo necessário
    const hasRG = documents.some((d) => d.documentType === DocumentType.RG);
    const hasCNH = documents.some((d) => d.documentType === DocumentType.CNH);
    const hasPassport = documents.some(
      (d) => d.documentType === DocumentType.PASSPORT
    );

    // Pelo menos um documento de identidade deve estar aprovado
    const hasValidDocument = hasRG || hasCNH || hasPassport;

    if (hasValidDocument) {
      await query(
        `UPDATE "User" 
         SET "hasVerifiedDocuments" = true, "updatedAt" = NOW()
         WHERE id = $1`,
        [userId]
      );
    }
  }

  /**
   * Listar todos os documentos pendentes de revisão (admin)
   */
  async getPendingDocuments(
    limit = 50, 
    offset = 0, 
    status?: string, 
    documentType?: string
  ) {
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    // Filtrar por status (padrão: UPLOADED se não especificado)
    if (status && status !== 'all') {
      whereClause += ` AND cd.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    } else {
      // Por padrão, mostrar apenas documentos aguardando revisão
      whereClause += ` AND cd.status = $${paramIndex}`;
      params.push(DocumentStatus.UPLOADED);
      paramIndex++;
    }

    // Filtrar por tipo de documento
    if (documentType && documentType !== 'all') {
      whereClause += ` AND cd."documentType" = $${paramIndex}`;
      params.push(documentType);
      paramIndex++;
    }

    const documents = await query<CourierDocument & { user: Partial<User> }>(
      `SELECT 
        cd.*,
        json_build_object(
          'id', u.id,
          'name', u.name,
          'email', u.email
        ) as user
       FROM "CourierDocument" cd
       JOIN "User" u ON u.id = cd."userId"
       ${whereClause}
       ORDER BY cd."createdAt" DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    const totalResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count 
       FROM "CourierDocument" cd
       ${whereClause}`,
      params
    );

    const total = totalResult ? parseInt(totalResult.count) : 0;

    return { documents, total };
  }

  /**
   * Deletar documento
   */
  async deleteDocument(documentId: string) {
    const document = await queryOne<CourierDocument>(
      'SELECT * FROM "CourierDocument" WHERE id = $1',
      [documentId]
    );

    if (!document) {
      throw new Error('Documento não encontrado');
    }

    await query('DELETE FROM "CourierDocument" WHERE id = $1', [documentId]);

    return { message: 'Documento deletado com sucesso' };
  }
}
