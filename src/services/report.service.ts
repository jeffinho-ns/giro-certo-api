import { query, queryOne } from '../lib/db';
import { Partner, User, WalletTransaction, TransactionType, TransactionStatus } from '../types';

export class ReportService {
  /**
   * Relatório de lojistas inadimplentes
   */
  async getOverduePartnersReport(): Promise<Partner[]> {
    const partners = await query<Partner>(
      `SELECT p.*
       FROM "Partner" p
       INNER JOIN "PartnerPayment" pp ON pp."partnerId" = p.id
       WHERE pp.status = 'OVERDUE'
       ORDER BY pp."dueDate" ASC`
    );

    return partners;
  }

  /**
   * Relatório de comissões pendentes
   */
  async getPendingCommissionsReport(filters?: {
    startDate?: Date;
    endDate?: Date;
    riderId?: string;
  }): Promise<{
    transactions: WalletTransaction[];
    total: number;
    count: number;
  }> {
    let whereClause = 'WHERE wt.type = $1 AND wt.status = $2';
    const params: any[] = [TransactionType.COMMISSION, TransactionStatus.pending];
    let paramIndex = 3;

    if (filters?.startDate) {
      whereClause += ` AND wt."createdAt" >= $${paramIndex}`;
      params.push(filters.startDate);
      paramIndex++;
    }

    if (filters?.endDate) {
      whereClause += ` AND wt."createdAt" <= $${paramIndex}`;
      params.push(filters.endDate);
      paramIndex++;
    }

    if (filters?.riderId) {
      whereClause += ` AND wt."userId" = $${paramIndex}`;
      params.push(filters.riderId);
      paramIndex++;
    }

    const transactions = await query<WalletTransaction>(
      `SELECT 
        wt.*,
        json_build_object(
          'id', u.id,
          'name', u.name,
          'email', u.email
        ) as rider,
        CASE 
          WHEN do.id IS NOT NULL THEN json_build_object(
            'id', do.id,
            'value', do.value,
            'deliveryFee', do."deliveryFee",
            'status', do.status,
            'createdAt', do."createdAt"
          )
          ELSE NULL
        END as "deliveryOrder"
       FROM "WalletTransaction" wt
       LEFT JOIN "User" u ON u.id = wt."userId"
       LEFT JOIN "DeliveryOrder" do ON do.id = wt."deliveryOrderId"
       ${whereClause}
       ORDER BY wt."createdAt" DESC`,
      params
    );

    const totalResult = await queryOne<{ total: string; count: string }>(
      `SELECT 
        COALESCE(SUM(wt.amount), 0) as total,
        COUNT(*) as count
       FROM "WalletTransaction" wt
       ${whereClause}`,
      params
    );

    return {
      transactions,
      total: parseFloat(totalResult?.total || '0'),
      count: parseInt(totalResult?.count || '0'),
    };
  }

  /**
   * Ranking de confiabilidade dos entregadores
   */
  async getRiderReliabilityRanking(limit: number = 50): Promise<
    Array<{
      rider: User;
      totalDeliveries: number;
      completedDeliveries: number;
      cancelledDeliveries: number;
      averageRating: number;
      onTimeRate: number;
      reliabilityScore: number;
    }>
  > {
    const rankings = await query<
      {
        riderId: string;
        riderName: string;
        riderEmail: string;
        totalDeliveries: string;
        completedDeliveries: string;
        cancelledDeliveries: string;
        averageRating: string;
        onTimeDeliveries: string;
      }
    >(
      `SELECT 
        u.id as "riderId",
        u.name as "riderName",
        u.email as "riderEmail",
        COUNT(DISTINCT do.id) as "totalDeliveries",
        COUNT(DISTINCT CASE WHEN do.status = 'completed' THEN do.id END) as "completedDeliveries",
        COUNT(DISTINCT CASE WHEN do.status = 'cancelled' THEN do.id END) as "cancelledDeliveries",
        COALESCE(AVG(r.rating), 0) as "averageRating",
        COUNT(DISTINCT CASE 
          WHEN do.status = 'completed' 
          AND do."completedAt" IS NOT NULL 
          AND do."estimatedTime" IS NOT NULL
          AND EXTRACT(EPOCH FROM (do."completedAt" - do."inProgressAt")) / 60 <= do."estimatedTime" * 1.1
          THEN do.id 
        END) as "onTimeDeliveries"
       FROM "User" u
       LEFT JOIN "DeliveryOrder" do ON do."riderId" = u.id
       LEFT JOIN "Rating" r ON r."userId" = u.id AND r."deliveryOrderId" IS NOT NULL
       WHERE u."pilotProfile" IS NOT NULL
       GROUP BY u.id, u.name, u.email
       HAVING COUNT(DISTINCT do.id) > 0
       ORDER BY 
         (COUNT(DISTINCT CASE WHEN do.status = 'completed' THEN do.id END)::float / NULLIF(COUNT(DISTINCT do.id), 0)) DESC,
         COALESCE(AVG(r.rating), 0) DESC,
         COUNT(DISTINCT do.id) DESC
       LIMIT $1`,
      [limit]
    );

    return rankings.map((row) => {
      const totalDeliveries = parseInt(row.totalDeliveries || '0');
      const completedDeliveries = parseInt(row.completedDeliveries || '0');
      const cancelledDeliveries = parseInt(row.cancelledDeliveries || '0');
      const onTimeDeliveries = parseInt(row.onTimeDeliveries || '0');
      const averageRating = parseFloat(row.averageRating || '0');

      // Calcular taxa de conclusão
      const completionRate = totalDeliveries > 0 ? completedDeliveries / totalDeliveries : 0;

      // Calcular taxa de pontualidade
      const onTimeRate = completedDeliveries > 0 ? onTimeDeliveries / completedDeliveries : 0;

      // Calcular score de confiabilidade (0-100)
      // 40% taxa de conclusão + 30% pontualidade + 30% rating
      const reliabilityScore =
        completionRate * 40 + onTimeRate * 30 + (averageRating / 5) * 30;

      return {
        rider: {
          id: row.riderId,
          name: row.riderName,
          email: row.riderEmail,
        } as User,
        totalDeliveries,
        completedDeliveries,
        cancelledDeliveries,
        averageRating,
        onTimeRate,
        reliabilityScore: Math.round(reliabilityScore * 100) / 100,
      };
    });
  }

  /**
   * Exportar relatório para CSV
   */
  convertToCSV(data: any[], headers: string[]): string {
    const csvRows: string[] = [];

    // Adicionar headers
    csvRows.push(headers.join(','));

    // Adicionar dados
    for (const row of data) {
      const values = headers.map((header) => {
        const value = row[header];
        if (value === null || value === undefined) return '';
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value).replace(/"/g, '""');
      });
      csvRows.push(values.map((v) => `"${v}"`).join(','));
    }

    return csvRows.join('\n');
  }
}
