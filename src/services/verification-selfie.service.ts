import { query, queryOne } from '../lib/db';
import {
  CreateVerificationSelfieDto,
  UpdateVerificationSelfieDto,
  VerificationSelfie,
  DocumentStatus,
  User,
} from '../types';
import { generateId } from '../utils/id';

export class VerificationSelfieService {
  /**
   * Criar uma nova selfie de verificação
   */
  async createSelfie(data: CreateVerificationSelfieDto) {
    // Verificar se o usuário existe
    const user = await queryOne<User>(
      'SELECT id FROM "User" WHERE id = $1',
      [data.userId]
    );

    if (!user) {
      throw new Error('Usuário não encontrado');
    }

    const selfieId = generateId();

    await query(
      `INSERT INTO "VerificationSelfie" (
        id, "userId", "fileUrl", status, "createdAt"
      ) VALUES ($1, $2, $3, $4, NOW())`,
      [selfieId, data.userId, data.fileUrl, DocumentStatus.UPLOADED]
    );

    const selfie = await queryOne<VerificationSelfie>(
      'SELECT * FROM "VerificationSelfie" WHERE id = $1',
      [selfieId]
    );

    return selfie;
  }

  /**
   * Listar selfies de um entregador
   */
  async getSelfiesByUserId(userId: string) {
    const selfies = await query<VerificationSelfie>(
      `SELECT * FROM "VerificationSelfie" 
       WHERE "userId" = $1 
       ORDER BY "createdAt" DESC`,
      [userId]
    );

    return selfies;
  }

  /**
   * Buscar selfie por ID
   */
  async getSelfieById(selfieId: string) {
    const selfie = await queryOne<VerificationSelfie & { user: Partial<User> }>(
      `SELECT vs.*, 
              json_build_object(
                'id', u.id,
                'name', u.name,
                'email', u.email,
                'photoUrl', u."photoUrl"
              ) as user
       FROM "VerificationSelfie" vs
       JOIN "User" u ON u.id = vs."userId"
       WHERE vs.id = $1`,
      [selfieId]
    );

    return selfie;
  }

  /**
   * Atualizar status da selfie (aprovado/rejeitado pelo admin)
   */
  async updateSelfieStatus(selfieId: string, data: UpdateVerificationSelfieDto) {
    const selfie = await queryOne<VerificationSelfie>(
      'SELECT * FROM "VerificationSelfie" WHERE id = $1',
      [selfieId]
    );

    if (!selfie) {
      throw new Error('Selfie não encontrada');
    }

    const updateFields: string[] = ['status = $1'];
    const params: any[] = [data.status];

    if (data.status === DocumentStatus.APPROVED) {
      updateFields.push('"verifiedAt" = NOW()');
      if (data.verifiedBy) {
        updateFields.push('"verifiedBy" = $' + (params.length + 1));
        params.push(data.verifiedBy);
      }
    }

    if (data.notes) {
      updateFields.push('notes = $' + (params.length + 1));
      params.push(data.notes);
    }

    params.push(selfieId);

    await query(
      `UPDATE "VerificationSelfie" 
       SET ${updateFields.join(', ')}
       WHERE id = $${params.length}`,
      params
    );

    const updatedSelfie = await queryOne<VerificationSelfie>(
      'SELECT * FROM "VerificationSelfie" WHERE id = $1',
      [selfieId]
    );

    return updatedSelfie;
  }

  /**
   * Listar todas as selfies pendentes de revisão (admin)
   */
  async getPendingSelfies(limit = 50, offset = 0) {
    const selfies = await query<VerificationSelfie & { user: Partial<User> }>(
      `SELECT 
        vs.*,
        json_build_object(
          'id', u.id,
          'name', u.name,
          'email', u.email,
          'photoUrl', u."photoUrl"
        ) as user
       FROM "VerificationSelfie" vs
       JOIN "User" u ON u.id = vs."userId"
       WHERE vs.status = $1
       ORDER BY vs."createdAt" DESC
       LIMIT $2 OFFSET $3`,
      [DocumentStatus.UPLOADED, limit, offset]
    );

    const totalResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count 
       FROM "VerificationSelfie" 
       WHERE status = $1`,
      [DocumentStatus.UPLOADED]
    );

    const total = totalResult ? parseInt(totalResult.count) : 0;

    return { selfies, total };
  }

  /**
   * Deletar selfie
   */
  async deleteSelfie(selfieId: string) {
    const selfie = await queryOne<VerificationSelfie>(
      'SELECT * FROM "VerificationSelfie" WHERE id = $1',
      [selfieId]
    );

    if (!selfie) {
      throw new Error('Selfie não encontrada');
    }

    await query('DELETE FROM "VerificationSelfie" WHERE id = $1', [selfieId]);

    return { message: 'Selfie deletada com sucesso' };
  }
}
