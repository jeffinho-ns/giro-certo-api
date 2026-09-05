import { query, queryOne, transaction } from '../lib/db';
import {
  CreateDeliveryRegistrationDto,
  UpdateDeliveryRegistrationStatusDto,
  DeliveryRegistration,
  DeliveryRegistrationStatus,
  User,
  VehicleType,
} from '../types';
import { generateId } from '../utils/id';

// Helper para converter buffer em base64
function bufferToBase64(buffer: Buffer | null | undefined): string | null {
  if (!buffer) return null;
  if (typeof buffer === 'string') return buffer; // Já é string
  return Buffer.isBuffer(buffer) ? buffer.toString('base64') : null;
}

/** Garante colunas adicionadas após o MVP — evita 400 se a migração SQL não rodou no Render. */
let schemaEnsured = false;
async function ensureDeliveryRegistrationSchema(): Promise<void> {
  if (schemaEnsured) return;
  await query(`
    ALTER TABLE "DeliveryRegistration"
      ADD COLUMN IF NOT EXISTS "selfieWithDocData" BYTEA,
      ADD COLUMN IF NOT EXISTS "motoWithPlateData" BYTEA,
      ADD COLUMN IF NOT EXISTS "platePlateCloseupData" BYTEA,
      ADD COLUMN IF NOT EXISTS "cnhPhotoData" BYTEA,
      ADD COLUMN IF NOT EXISTS "crlvPhotoData" BYTEA,
      ADD COLUMN IF NOT EXISTS "vehicleType" VARCHAR(20) NOT NULL DEFAULT 'MOTORCYCLE',
      ADD COLUMN IF NOT EXISTS equipments TEXT[] NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS "bikeOptionalReceiptData" BYTEA
  `);
  schemaEnsured = true;
}

export class DeliveryRegistrationService {
  /**
   * Criar um novo registro de delivery (entregador)
   */
  async createRegistration(
    userId: string,
    data: CreateDeliveryRegistrationDto
  ) {
    // Verificar se o usuário existe
    const user = await queryOne<User>(
      'SELECT id FROM "User" WHERE id = $1',
      [userId]
    );

    if (!user) {
      throw new Error('Usuário não encontrado');
    }

    await ensureDeliveryRegistrationSchema();

    const registrationId = generateId();
    const lastOilChangeDate = data.lastOilChangeDate || null;
    const lastOilChangeKm = data.lastOilChangeKm || null;
    const vehicleType = data.vehicleType || VehicleType.MOTORCYCLE;
    const equipments = Array.isArray(data.equipments) ? data.equipments : [];
    const withReceipt = data as CreateDeliveryRegistrationDto & {
      bikeOptionalReceiptData?: Buffer | null;
    };
    const bikeOptionalReceipt =
      withReceipt.bikeOptionalReceiptData ??
      (data.bikeOptionalReceiptBase64
        ? Buffer.from(data.bikeOptionalReceiptBase64, 'base64')
        : null);

    if (!data.documentId || !String(data.documentId).trim()) {
      throw new Error('documentId (CPF/CNH) é obrigatório');
    }
    const plateLicense =
      data.plateLicense == null || String(data.plateLicense).trim() === ''
        ? '-'
        : String(data.plateLicense);

    try {
      await query(
        `INSERT INTO "DeliveryRegistration" (
          id, "userId", status, "vehicleType", "cpfCnh", "selfieWithDocData", 
          "motoWithPlateData", "platePlateCloseupData", "cnhPhotoData", 
          "crlvPhotoData", "plateLicense", "currentKilometers", 
          "lastOilChangeDate", "lastOilChangeKm", "emergencyPhone", 
          "consentImages", equipments, "bikeOptionalReceiptData", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW())`,
        [
          registrationId,
          userId,
          DeliveryRegistrationStatus.PENDING,
          vehicleType,
          data.documentId,
          data.selfieWithDocData || null,
          data.motoWithPlateData || null,
          data.platePlateCloseupData || null,
          data.cnhPhotoData || null,
          data.crlvPhotoData || null,
          plateLicense,
          data.currentKilometers,
          lastOilChangeDate,
          lastOilChangeKm,
          data.emergencyPhone || null,
          data.consentImages,
          equipments,
          bikeOptionalReceipt || null,
        ]
      );
    } catch (err: any) {
      // Fallback: schema antigo (antes de vehicleType/equipments) — como o create original
      if (err?.code === '42703' || String(err?.message || '').includes('does not exist')) {
        console.warn(
          '[delivery-registration] INSERT completo falhou; tentando schema legado:',
          err?.message
        );
        schemaEnsured = false;
        await query(
          `INSERT INTO "DeliveryRegistration" (
            id, "userId", status, "cpfCnh", "selfieWithDocData",
            "motoWithPlateData", "platePlateCloseupData", "cnhPhotoData",
            "crlvPhotoData", "plateLicense", "currentKilometers",
            "lastOilChangeDate", "lastOilChangeKm", "emergencyPhone",
            "consentImages", "createdAt", "updatedAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())`,
          [
            registrationId,
            userId,
            DeliveryRegistrationStatus.PENDING,
            data.documentId,
            data.selfieWithDocData || null,
            data.motoWithPlateData || null,
            data.platePlateCloseupData || null,
            data.cnhPhotoData || null,
            data.crlvPhotoData || null,
            plateLicense,
            data.currentKilometers,
            lastOilChangeDate,
            lastOilChangeKm,
            data.emergencyPhone || null,
            data.consentImages,
          ]
        );
      } else if (err?.code === '22001') {
        throw new Error('Algum campo texto excede o tamanho permitido');
      } else {
        throw err;
      }
    }

    // Nunca devolver BYTEA/base64 no create — payload enorme causa 400/OOM no Render.
    // O app só precisa de HTTP 201; o body é opcional.
    const registration = await queryOne<any>(
      `SELECT id, "userId", status, "cpfCnh", "plateLicense",
              "currentKilometers", "lastOilChangeDate", "lastOilChangeKm",
              "emergencyPhone", "consentImages",
              "approvedAt", "rejectionReason", "adminNotes",
              "createdAt", "updatedAt"
       FROM "DeliveryRegistration" WHERE id = $1`,
      [registrationId]
    );

    if (!registration) {
      throw new Error('Erro ao criar registro de delivery');
    }

    return registration;
  }

  /**
   * Buscar registro por ID com dados do usuário
   */
  async getRegistrationById(registrationId: string) {
    const registration = await queryOne<any>(
      `SELECT dr.*, 
              json_build_object(
                'id', u.id,
                'name', u.name,
                'email', u.email
              ) as user
       FROM "DeliveryRegistration" dr
       JOIN "User" u ON u.id = dr."userId"
       WHERE dr.id = $1`,
      [registrationId]
    );

    if (!registration) return null;

    // Converter imagens em base64
    return {
      ...registration,
      selfieWithDocData: bufferToBase64(registration.selfieWithDocData),
      motoWithPlateData: bufferToBase64(registration.motoWithPlateData),
      platePlateCloseupData: bufferToBase64(registration.platePlateCloseupData),
      cnhPhotoData: bufferToBase64(registration.cnhPhotoData),
      crlvPhotoData: bufferToBase64(registration.crlvPhotoData),
      bikeOptionalReceiptData: bufferToBase64(
        (registration as any).bikeOptionalReceiptData
      ),
    };
  }

  /**
   * Metadados do cadastro (sem imagens BYTEA) — uso no app mobile.
   */
  async getRegistrationSummariesByUserId(userId: string) {
    const registrations = await query<any>(
      `SELECT id, "userId", status, "vehicleType", "plateLicense",
              "currentKilometers", "lastOilChangeDate", "lastOilChangeKm",
              "emergencyPhone", equipments, "consentImages",
              "approvedAt", "rejectionReason", "adminNotes",
              "createdAt", "updatedAt"
       FROM "DeliveryRegistration"
       WHERE "userId" = $1
       ORDER BY "createdAt" DESC`,
      [userId]
    );
    return registrations;
  }

  /**
   * Listar registros de um usuário
   */
  async getRegistrationsByUserId(userId: string) {
    const registrations = await query<any>(
      `SELECT * FROM "DeliveryRegistration" 
       WHERE "userId" = $1 
       ORDER BY "createdAt" DESC`,
      [userId]
    );

    // Converter imagens em base64
    return registrations.map((reg) => ({
      ...reg,
      selfieWithDocData: bufferToBase64(reg.selfieWithDocData),
      motoWithPlateData: bufferToBase64(reg.motoWithPlateData),
      platePlateCloseupData: bufferToBase64(reg.platePlateCloseupData),
      cnhPhotoData: bufferToBase64(reg.cnhPhotoData),
      crlvPhotoData: bufferToBase64(reg.crlvPhotoData),
      bikeOptionalReceiptData: bufferToBase64(
        (reg as any).bikeOptionalReceiptData
      ),
    }));
  }

  /**
   * Listar registros pendentes para revisão (admin)
   */
  async getPendingRegistrations(limit: number = 50, offset: number = 0) {
    const registrations = await query<any>(
      `SELECT dr.*, 
              json_build_object(
                'id', u.id,
                'name', u.name,
                'email', u.email,
                'createdAt', u."createdAt"
              ) as user
       FROM "DeliveryRegistration" dr
       JOIN "User" u ON u.id = dr."userId"
       WHERE dr.status IN ('PENDING', 'UNDER_REVIEW')
       ORDER BY dr."createdAt" DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    // Converter imagens BYTEA em base64
    const registrationsWithBase64 = registrations.map((reg) => ({
      ...reg,
      selfieWithDocData: bufferToBase64(reg.selfieWithDocData),
      motoWithPlateData: bufferToBase64(reg.motoWithPlateData),
      platePlateCloseupData: bufferToBase64(reg.platePlateCloseupData),
      cnhPhotoData: bufferToBase64(reg.cnhPhotoData),
      crlvPhotoData: bufferToBase64(reg.crlvPhotoData),
      bikeOptionalReceiptData: bufferToBase64(
        (reg as any).bikeOptionalReceiptData
      ),
    }));

    const total = await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM "DeliveryRegistration" 
       WHERE status IN ('PENDING', 'UNDER_REVIEW')`,
      []
    );

    return {
      registrations: registrationsWithBase64,
      total: total?.count || 0,
      limit,
      offset,
    };
  }

  /**
   * Atualizar status do registro (aprovado/rejeitado)
   */
  async updateRegistrationStatus(
    registrationId: string,
    data: UpdateDeliveryRegistrationStatusDto
  ) {
    const registration = await queryOne<DeliveryRegistration>(
      'SELECT * FROM "DeliveryRegistration" WHERE id = $1',
      [registrationId]
    );

    if (!registration) {
      throw new Error('Registro de delivery não encontrado');
    }

    const approvedAt =
      data.status === DeliveryRegistrationStatus.APPROVED ? new Date() : null;

    await query(
      `UPDATE "DeliveryRegistration" 
       SET status = $1, "approvedAt" = $2, "approvedBy" = $3, 
           "rejectionReason" = $4, "adminNotes" = $5, "updatedAt" = NOW()
       WHERE id = $6`,
      [
        data.status,
        approvedAt,
        data.approvedBy || null,
        data.rejectionReason || null,
        data.adminNotes || null,
        registrationId,
      ]
    );

    const updated = await queryOne<any>(
      'SELECT * FROM "DeliveryRegistration" WHERE id = $1',
      [registrationId]
    );

    if (!updated) throw new Error('Erro ao atualizar registro');

    // Converter imagens em base64
    return {
      ...updated,
      selfieWithDocData: bufferToBase64(updated.selfieWithDocData),
      motoWithPlateData: bufferToBase64(updated.motoWithPlateData),
      platePlateCloseupData: bufferToBase64(updated.platePlateCloseupData),
      cnhPhotoData: bufferToBase64(updated.cnhPhotoData),
      crlvPhotoData: bufferToBase64(updated.crlvPhotoData),
      bikeOptionalReceiptData: bufferToBase64(
        (updated as any).bikeOptionalReceiptData
      ),
    };
  }

  /**
   * Buscar estatísticas de registros (admin)
   */
  async getStatistics() {
    const stats = await queryOne<any>(
      `SELECT
        COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'UNDER_REVIEW' THEN 1 END) as underReview,
        COUNT(CASE WHEN status = 'APPROVED' THEN 1 END) as approved,
        COUNT(CASE WHEN status = 'REJECTED' THEN 1 END) as rejected,
        COUNT(*) as total
       FROM "DeliveryRegistration"`,
      []
    );

    return stats;
  }
}
