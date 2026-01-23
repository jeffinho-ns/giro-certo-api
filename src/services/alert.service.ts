import { query, queryOne } from '../lib/db';
import { generateId } from '../utils/id';

export enum AlertType {
  DOCUMENT_EXPIRING = 'DOCUMENT_EXPIRING',
  MAINTENANCE_CRITICAL = 'MAINTENANCE_CRITICAL',
  PAYMENT_OVERDUE = 'PAYMENT_OVERDUE',
}

export enum AlertSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  userId: string | null;
  partnerId: string | null;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}

export class AlertService {
  /**
   * Criar alerta
   */
  async createAlert(data: {
    type: AlertType;
    severity: AlertSeverity;
    title: string;
    message: string;
    userId?: string;
    partnerId?: string;
  }): Promise<Alert> {
    const alertId = generateId();

    await query(
      `INSERT INTO "Alert" (
        id, type, severity, title, message, "userId", "partnerId", "isRead", "createdAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, false, NOW())`,
      [
        alertId,
        data.type,
        data.severity,
        data.title,
        data.message,
        data.userId || null,
        data.partnerId || null,
      ]
    );

    const alert = await queryOne<Alert>('SELECT * FROM "Alert" WHERE id = $1', [alertId]);
    if (!alert) {
      throw new Error('Erro ao criar alerta');
    }

    return alert;
  }

  /**
   * Listar alertas com filtros
   */
  async listAlerts(filters?: {
    type?: AlertType;
    severity?: AlertSeverity;
    userId?: string;
    partnerId?: string;
    isRead?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ alerts: Alert[]; total: number }> {
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (filters?.type) {
      whereClause += ` AND type = $${paramIndex}`;
      params.push(filters.type);
      paramIndex++;
    }

    if (filters?.severity) {
      whereClause += ` AND severity = $${paramIndex}`;
      params.push(filters.severity);
      paramIndex++;
    }

    if (filters?.userId) {
      whereClause += ` AND "userId" = $${paramIndex}`;
      params.push(filters.userId);
      paramIndex++;
    }

    if (filters?.partnerId) {
      whereClause += ` AND "partnerId" = $${paramIndex}`;
      params.push(filters.partnerId);
      paramIndex++;
    }

    if (filters?.isRead !== undefined) {
      whereClause += ` AND "isRead" = $${paramIndex}`;
      params.push(filters.isRead);
      paramIndex++;
    }

    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;

    // Contar total
    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM "Alert" ${whereClause}`,
      params
    );
    const total = parseInt(countResult?.count || '0');

    // Buscar alertas
    const alerts = await query<Alert>(
      `SELECT * FROM "Alert" 
       ${whereClause}
       ORDER BY "createdAt" DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    return { alerts, total };
  }

  /**
   * Buscar alerta por ID
   */
  async getAlertById(alertId: string): Promise<Alert | null> {
    return await queryOne<Alert>('SELECT * FROM "Alert" WHERE id = $1', [alertId]);
  }

  /**
   * Marcar alerta como lido
   */
  async markAsRead(alertId: string): Promise<Alert> {
    await query(
      `UPDATE "Alert" 
       SET "isRead" = true, "readAt" = NOW()
       WHERE id = $1`,
      [alertId]
    );

    const alert = await queryOne<Alert>('SELECT * FROM "Alert" WHERE id = $1', [alertId]);
    if (!alert) {
      throw new Error('Alerta não encontrado');
    }

    return alert;
  }

  /**
   * Marcar todos os alertas como lidos (para um usuário ou parceiro)
   */
  async markAllAsRead(userId?: string, partnerId?: string): Promise<number> {
    let whereClause = 'WHERE "isRead" = false';
    const params: any[] = [];
    let paramIndex = 1;

    if (userId) {
      whereClause += ` AND "userId" = $${paramIndex}`;
      params.push(userId);
      paramIndex++;
    }

    if (partnerId) {
      whereClause += ` AND "partnerId" = $${paramIndex}`;
      params.push(partnerId);
      paramIndex++;
    }

    const result = await query(
      `UPDATE "Alert" 
       SET "isRead" = true, "readAt" = NOW()
       ${whereClause}`,
      params
    );

    return result.length || 0;
  }

  /**
   * Deletar alerta
   */
  async deleteAlert(alertId: string): Promise<void> {
    await query('DELETE FROM "Alert" WHERE id = $1', [alertId]);
  }

  /**
   * Verificar e criar alertas automáticos
   */
  async checkAndCreateAlerts(): Promise<number> {
    let alertsCreated = 0;

    // 1. Verificar documentos expirando (30 dias antes)
    const expiringDocuments = await query<{
      id: string;
      userId: string;
      documentType: string;
      expirationDate: Date;
      userName: string;
    }>(
      `SELECT 
        cd.id,
        cd."userId",
        cd."documentType",
        cd."expirationDate",
        u.name as "userName"
       FROM "CourierDocument" cd
       INNER JOIN "User" u ON u.id = cd."userId"
       WHERE cd.status = 'APPROVED'
       AND cd."expirationDate" IS NOT NULL
       AND cd."expirationDate" <= (NOW() + INTERVAL '30 days')
       AND cd."expirationDate" > NOW()
       AND NOT EXISTS (
         SELECT 1 FROM "Alert" a
         WHERE a."userId" = cd."userId"
         AND a.type = 'DOCUMENT_EXPIRING'
         AND a."createdAt" > (NOW() - INTERVAL '1 day')
       )`
    );

    for (const doc of expiringDocuments) {
      const daysUntilExpiry = Math.ceil(
        (new Date(doc.expirationDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );

      await this.createAlert({
        type: AlertType.DOCUMENT_EXPIRING,
        severity: daysUntilExpiry <= 7 ? AlertSeverity.HIGH : AlertSeverity.MEDIUM,
        title: `Documento expirando em ${daysUntilExpiry} dias`,
        message: `O documento ${doc.documentType} do entregador ${doc.userName} expira em ${daysUntilExpiry} dias (${new Date(doc.expirationDate).toLocaleDateString('pt-BR')}).`,
        userId: doc.userId,
      });
      alertsCreated++;
    }

    // 2. Verificar manutenções críticas
    const criticalMaintenances = await query<{
      id: string;
      userId: string;
      bikeId: string;
      status: string;
      wearPercentage: number;
      userName: string;
      bikeModel: string;
    }>(
      `SELECT 
        ml.id,
        ml."userId",
        ml."bikeId",
        ml.status,
        ml."wearPercentage",
        u.name as "userName",
        b.model as "bikeModel"
       FROM "MaintenanceLog" ml
       INNER JOIN "User" u ON u.id = ml."userId"
       INNER JOIN "Bike" b ON b.id = ml."bikeId"
       WHERE (ml.status = 'CRITICO' OR ml."wearPercentage" >= 0.9)
       AND NOT EXISTS (
         SELECT 1 FROM "Alert" a
         WHERE a."userId" = ml."userId"
         AND a.type = 'MAINTENANCE_CRITICAL'
         AND a."createdAt" > (NOW() - INTERVAL '1 day')
       )`
    );

    for (const maintenance of criticalMaintenances) {
      await this.createAlert({
        type: AlertType.MAINTENANCE_CRITICAL,
        severity: AlertSeverity.CRITICAL,
        title: `Manutenção crítica: ${maintenance.bikeModel}`,
        message: `O veículo ${maintenance.bikeModel} do entregador ${maintenance.userName} requer manutenção urgente. Status: ${maintenance.status}, Desgaste: ${(maintenance.wearPercentage * 100).toFixed(0)}%.`,
        userId: maintenance.userId,
      });
      alertsCreated++;
    }

    // 3. Verificar pagamentos atrasados
    const overduePayments = await query<{
      id: string;
      partnerId: string;
      partnerName: string;
      dueDate: Date;
      daysOverdue: number;
    }>(
      `SELECT 
        pp.id,
        pp."partnerId",
        p.name as "partnerName",
        pp."dueDate",
        EXTRACT(DAY FROM (NOW() - pp."dueDate"))::int as "daysOverdue"
       FROM "PartnerPayment" pp
       INNER JOIN "Partner" p ON p.id = pp."partnerId"
       WHERE pp.status = 'OVERDUE'
       AND pp."dueDate" < NOW()
       AND NOT EXISTS (
         SELECT 1 FROM "Alert" a
         WHERE a."partnerId" = pp."partnerId"
         AND a.type = 'PAYMENT_OVERDUE'
         AND a."createdAt" > (NOW() - INTERVAL '1 day')
       )`
    );

    for (const payment of overduePayments) {
      await this.createAlert({
        type: AlertType.PAYMENT_OVERDUE,
        severity: payment.daysOverdue > 30 ? AlertSeverity.CRITICAL : AlertSeverity.HIGH,
        title: `Pagamento atrasado: ${payment.partnerName}`,
        message: `O parceiro ${payment.partnerName} está com pagamento atrasado há ${payment.daysOverdue} dias. Vencimento: ${new Date(payment.dueDate).toLocaleDateString('pt-BR')}.`,
        partnerId: payment.partnerId,
      });
      alertsCreated++;
    }

    return alertsCreated;
  }

  /**
   * Obter estatísticas de alertas
   */
  async getAlertStats(userId?: string, partnerId?: string): Promise<{
    total: number;
    unread: number;
    byType: Record<AlertType, number>;
    bySeverity: Record<AlertSeverity, number>;
  }> {
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (userId) {
      whereClause += ` AND "userId" = $${paramIndex}`;
      params.push(userId);
      paramIndex++;
    }

    if (partnerId) {
      whereClause += ` AND "partnerId" = $${paramIndex}`;
      params.push(partnerId);
      paramIndex++;
    }

    const stats = await queryOne<{
      total: string;
      unread: string;
      documentExpiring: string;
      maintenanceCritical: string;
      paymentOverdue: string;
      low: string;
      medium: string;
      high: string;
      critical: string;
    }>(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE "isRead" = false) as unread,
        COUNT(*) FILTER (WHERE type = 'DOCUMENT_EXPIRING') as "documentExpiring",
        COUNT(*) FILTER (WHERE type = 'MAINTENANCE_CRITICAL') as "maintenanceCritical",
        COUNT(*) FILTER (WHERE type = 'PAYMENT_OVERDUE') as "paymentOverdue",
        COUNT(*) FILTER (WHERE severity = 'LOW') as low,
        COUNT(*) FILTER (WHERE severity = 'MEDIUM') as medium,
        COUNT(*) FILTER (WHERE severity = 'HIGH') as high,
        COUNT(*) FILTER (WHERE severity = 'CRITICAL') as critical
       FROM "Alert" 
       ${whereClause}`,
      params
    );

    return {
      total: parseInt(stats?.total || '0'),
      unread: parseInt(stats?.unread || '0'),
      byType: {
        [AlertType.DOCUMENT_EXPIRING]: parseInt(stats?.documentExpiring || '0'),
        [AlertType.MAINTENANCE_CRITICAL]: parseInt(stats?.maintenanceCritical || '0'),
        [AlertType.PAYMENT_OVERDUE]: parseInt(stats?.paymentOverdue || '0'),
      },
      bySeverity: {
        [AlertSeverity.LOW]: parseInt(stats?.low || '0'),
        [AlertSeverity.MEDIUM]: parseInt(stats?.medium || '0'),
        [AlertSeverity.HIGH]: parseInt(stats?.high || '0'),
        [AlertSeverity.CRITICAL]: parseInt(stats?.critical || '0'),
      },
    };
  }
}
