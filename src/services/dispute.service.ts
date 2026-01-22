import { query, queryOne, transaction } from '../lib/db';
import { Dispute, CreateDisputeDto, ResolveDisputeDto, DisputeStatus, DisputeType } from '../types';
import { generateId } from '../utils/id';

export class DisputeService {
  /**
   * Criar uma nova disputa
   */
  async createDispute(userId: string, data: CreateDisputeDto): Promise<Dispute> {
    const disputeId = generateId();

    await query(
      `INSERT INTO "Dispute" (
        id, "deliveryOrderId", "reportedBy", "disputeType", 
        status, description, "locationLogs", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [
        disputeId,
        data.deliveryOrderId || null,
        userId,
        data.disputeType,
        DisputeStatus.OPEN,
        data.description,
        data.locationLogs ? JSON.stringify(data.locationLogs) : null,
      ]
    );

    const dispute = await this.getDisputeById(disputeId);
    if (!dispute) {
      throw new Error('Erro ao criar disputa');
    }

    return dispute;
  }

  /**
   * Listar disputas com filtros
   */
  async listDisputes(filters?: {
    status?: DisputeStatus;
    disputeType?: DisputeType;
    deliveryOrderId?: string;
    reportedBy?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ disputes: Dispute[]; total: number }> {
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (filters?.status) {
      whereClause += ` AND d.status = $${paramIndex}`;
      params.push(filters.status);
      paramIndex++;
    }

    if (filters?.disputeType) {
      whereClause += ` AND d."disputeType" = $${paramIndex}`;
      params.push(filters.disputeType);
      paramIndex++;
    }

    if (filters?.deliveryOrderId) {
      whereClause += ` AND d."deliveryOrderId" = $${paramIndex}`;
      params.push(filters.deliveryOrderId);
      paramIndex++;
    }

    if (filters?.reportedBy) {
      whereClause += ` AND d."reportedBy" = $${paramIndex}`;
      params.push(filters.reportedBy);
      paramIndex++;
    }

    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;

    // Contar total
    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM "Dispute" d ${whereClause}`,
      params
    );
    const total = parseInt(countResult?.count || '0');

    // Buscar disputas com relacionamentos
    const disputes = await query<Dispute>(
      `SELECT 
        d.*,
        CASE 
          WHEN do.id IS NOT NULL THEN json_build_object(
            'id', do.id,
            'status', do.status,
            'value', do.value,
            'deliveryFee', do."deliveryFee",
            'storeAddress', do."storeAddress",
            'deliveryAddress', do."deliveryAddress",
            'createdAt', do."createdAt"
          )
          ELSE NULL
        END as "deliveryOrder",
        json_build_object(
          'id', u.id,
          'name', u.name,
          'email', u.email
        ) as reporter
       FROM "Dispute" d
       LEFT JOIN "DeliveryOrder" do ON do.id = d."deliveryOrderId"
       LEFT JOIN "User" u ON u.id = d."reportedBy"
       ${whereClause}
       ORDER BY d."createdAt" DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    return { disputes, total };
  }

  /**
   * Buscar disputa por ID
   */
  async getDisputeById(disputeId: string): Promise<Dispute | null> {
    const dispute = await queryOne<Dispute>(
      `SELECT 
        d.*,
        CASE 
          WHEN do.id IS NOT NULL THEN json_build_object(
            'id', do.id,
            'status', do.status,
            'value', do.value,
            'deliveryFee', do."deliveryFee",
            'storeAddress', do."storeAddress",
            'deliveryAddress', do."deliveryAddress",
            'storeLatitude', do."storeLatitude",
            'storeLongitude', do."storeLongitude",
            'deliveryLatitude', do."deliveryLatitude",
            'deliveryLongitude', do."deliveryLongitude",
            'riderId', do."riderId",
            'createdAt', do."createdAt",
            'acceptedAt', do."acceptedAt",
            'inProgressAt', do."inProgressAt",
            'completedAt', do."completedAt"
          )
          ELSE NULL
        END as "deliveryOrder",
        json_build_object(
          'id', u.id,
          'name', u.name,
          'email', u.email
        ) as reporter,
        CASE 
          WHEN resolver.id IS NOT NULL THEN json_build_object(
            'id', resolver.id,
            'name', resolver.name,
            'email', resolver.email
          )
          ELSE NULL
        END as resolver
       FROM "Dispute" d
       LEFT JOIN "DeliveryOrder" do ON do.id = d."deliveryOrderId"
       LEFT JOIN "User" u ON u.id = d."reportedBy"
       LEFT JOIN "User" resolver ON resolver.id = d."resolvedBy"
       WHERE d.id = $1`,
      [disputeId]
    );

    return dispute || null;
  }

  /**
   * Resolver disputa (admin)
   */
  async resolveDispute(disputeId: string, adminId: string, data: ResolveDisputeDto): Promise<Dispute> {
    const status = data.status || DisputeStatus.RESOLVED;

    await query(
      `UPDATE "Dispute" 
       SET 
         status = $1,
         resolution = $2,
         "resolvedBy" = $3,
         "resolvedAt" = NOW(),
         "updatedAt" = NOW()
       WHERE id = $4`,
      [status, data.resolution, adminId, disputeId]
    );

    const dispute = await this.getDisputeById(disputeId);
    if (!dispute) {
      throw new Error('Disputa não encontrada');
    }

    return dispute;
  }

  /**
   * Atualizar status da disputa
   */
  async updateDisputeStatus(
    disputeId: string,
    status: DisputeStatus
  ): Promise<Dispute> {
    await query(
      `UPDATE "Dispute" 
       SET status = $1, "updatedAt" = NOW()
       WHERE id = $2`,
      [status, disputeId]
    );

    const dispute = await this.getDisputeById(disputeId);
    if (!dispute) {
      throw new Error('Disputa não encontrada');
    }

    return dispute;
  }

  /**
   * Deletar disputa (apenas se estiver fechada)
   */
  async deleteDispute(disputeId: string): Promise<void> {
    const dispute = await this.getDisputeById(disputeId);
    if (!dispute) {
      throw new Error('Disputa não encontrada');
    }

    if (dispute.status !== DisputeStatus.CLOSED) {
      throw new Error('Apenas disputas fechadas podem ser deletadas');
    }

    await query('DELETE FROM "Dispute" WHERE id = $1', [disputeId]);
  }

  /**
   * Obter estatísticas de disputas
   */
  async getDisputeStats(): Promise<{
    total: number;
    open: number;
    underReview: number;
    resolved: number;
    closed: number;
    byType: Record<DisputeType, number>;
  }> {
    const stats = await queryOne<{
      total: string;
      open: string;
      underReview: string;
      resolved: string;
      closed: string;
      deliveryIssue: string;
      paymentIssue: string;
      riderComplaint: string;
      storeComplaint: string;
    }>(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'OPEN') as open,
        COUNT(*) FILTER (WHERE status = 'UNDER_REVIEW') as "underReview",
        COUNT(*) FILTER (WHERE status = 'RESOLVED') as resolved,
        COUNT(*) FILTER (WHERE status = 'CLOSED') as closed,
        COUNT(*) FILTER (WHERE "disputeType" = 'DELIVERY_ISSUE') as "deliveryIssue",
        COUNT(*) FILTER (WHERE "disputeType" = 'PAYMENT_ISSUE') as "paymentIssue",
        COUNT(*) FILTER (WHERE "disputeType" = 'RIDER_COMPLAINT') as "riderComplaint",
        COUNT(*) FILTER (WHERE "disputeType" = 'STORE_COMPLAINT') as "storeComplaint"
       FROM "Dispute"`
    );

    return {
      total: parseInt(stats?.total || '0'),
      open: parseInt(stats?.open || '0'),
      underReview: parseInt(stats?.underReview || '0'),
      resolved: parseInt(stats?.resolved || '0'),
      closed: parseInt(stats?.closed || '0'),
      byType: {
        [DisputeType.DELIVERY_ISSUE]: parseInt(stats?.deliveryIssue || '0'),
        [DisputeType.PAYMENT_ISSUE]: parseInt(stats?.paymentIssue || '0'),
        [DisputeType.RIDER_COMPLAINT]: parseInt(stats?.riderComplaint || '0'),
        [DisputeType.STORE_COMPLAINT]: parseInt(stats?.storeComplaint || '0'),
      },
    };
  }
}
