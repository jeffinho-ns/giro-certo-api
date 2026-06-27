import { query, queryOne, transaction } from '../lib/db';
import {
  CreatePartnerDto,
  UpdatePartnerDto,
  CreatePartnerPaymentDto,
  UpdatePartnerPaymentDto,
  RecordPaymentDto,
  Partner,
  PartnerPayment,
  PaymentStatus,
  PaymentPlanType,
  UserRole,
} from '../types';
import { generateId } from '../utils/id';
import { uniqueSlug } from '../utils/slug';
import bcrypt from 'bcryptjs';

export class PartnerService {
  private async assertPartnerCanBeDeleted(client: any, partnerId: string) {
    const hasDeliveryOrders = await client.query(
      `SELECT EXISTS (
        SELECT 1 FROM "DeliveryOrder" WHERE "storeId" = $1
      ) as exists`,
      [partnerId]
    );

    if (hasDeliveryOrders.rows[0]?.exists) {
      throw new Error(
        'Não é possível excluir o parceiro porque já existem pedidos de entrega vinculados a ele.'
      );
    }

    const settlementBatchesTable = await client.query(
      `SELECT to_regclass('"delivery_settlement_batches"') as "tableName"`
    );
    if (settlementBatchesTable.rows[0]?.tableName) {
      const hasSettlementBatches = await client.query(
        `SELECT EXISTS (
          SELECT 1 FROM "delivery_settlement_batches" WHERE partner_id = $1
        ) as exists`,
        [partnerId]
      );
      if (hasSettlementBatches.rows[0]?.exists) {
        throw new Error(
          'Não é possível excluir o parceiro porque já existem lotes de repasse vinculados.'
        );
      }
    }

    const settlementLedgerTable = await client.query(
      `SELECT to_regclass('"delivery_settlement_ledger"') as "tableName"`
    );
    if (settlementLedgerTable.rows[0]?.tableName) {
      const hasSettlementLedger = await client.query(
        `SELECT EXISTS (
          SELECT 1 FROM "delivery_settlement_ledger" WHERE "storeId" = $1
        ) as exists`,
        [partnerId]
      );
      if (hasSettlementLedger.rows[0]?.exists) {
        throw new Error(
          'Não é possível excluir o parceiro porque já existem lançamentos financeiros vinculados.'
        );
      }
    }
  }

  /**
   * Excluir parceiro e todos os usuários vinculados
   */
  async deletePartner(partnerId: string, protectedUserId?: string) {
    const partner = await queryOne<Partner>(
      'SELECT id, name, email, type, "createdAt", "updatedAt" FROM "Partner" WHERE id = $1',
      [partnerId]
    );

    if (!partner) {
      throw new Error('Parceiro não encontrado');
    }

    await transaction(async (client) => {
      await this.assertPartnerCanBeDeleted(client, partnerId);

      const linkedUsersResult = await client.query(
        'SELECT id FROM "User" WHERE "partnerId" = $1',
        [partnerId]
      );
      const linkedUserIds = (linkedUsersResult.rows as Array<{ id: string }>).map(
        (row) => row.id
      );

      if (protectedUserId && linkedUserIds.includes(protectedUserId)) {
        throw new Error(
          'Você não pode excluir um parceiro que contém o seu próprio usuário vinculado.'
        );
      }

      if (linkedUserIds.length > 0) {
        await client.query(
          `UPDATE "DeliveryOrder"
           SET "riderId" = NULL, "riderName" = NULL
           WHERE "riderId" = ANY($1::text[])`,
          [linkedUserIds]
        );

        const deliveryRegistrationTable = await client.query(
          `SELECT to_regclass('"DeliveryRegistration"') as "tableName"`
        );
        if (deliveryRegistrationTable.rows[0]?.tableName) {
          await client.query(
            `DELETE FROM "DeliveryRegistration"
             WHERE "userId" = ANY($1::text[])`,
            [linkedUserIds]
          );
        }

        await client.query(
          `DELETE FROM "User"
           WHERE "partnerId" = $1`,
          [partnerId]
        );
      }

      await client.query(
        `DELETE FROM "PartnerPayment"
         WHERE "partnerId" = $1`,
        [partnerId]
      );

      await client.query(
        `DELETE FROM "Partner"
         WHERE id = $1`,
        [partnerId]
      );
    });

    return partner;
  }

  /**
   * Criar um novo parceiro e usuário associado
   */
  async createPartner(data: CreatePartnerDto) {
    const partnerId = generateId();
    const email = data.email?.trim();

    // Slug público único para a vitrine (nome separado por hífen).
    const slug = await uniqueSlug(data.name, async (candidate) => {
      const row = await queryOne<{ id: string }>(
        'SELECT id FROM "Partner" WHERE slug = $1',
        [candidate]
      );
      return !!row;
    });

    // Verificar se o email já existe (se fornecido)
    if (email) {
      if (!data.password || data.password.trim().length < 6) {
        throw new Error('Senha é obrigatória e deve ter pelo menos 6 caracteres para criar login do lojista.');
      }

      const existingUser = await queryOne<{ id: string }>(
        'SELECT id FROM "User" WHERE email = $1',
        [email]
      );

      if (existingUser) {
        throw new Error('Email já cadastrado. Use um email diferente ou atualize o usuário existente.');
      }
    }

    // Criar parceiro e usuário em uma transação
    await transaction(async (client) => {
      // 1. Criar parceiro
      await client.query(
        `INSERT INTO "Partner" (
          id, name, slug, type, address, latitude, longitude,
          phone, email, specialties, "photoUrl",
          cnpj, "companyName", "tradingName", "stateRegistration",
          "maxServiceRadius", "avgPreparationTime", "operatingHours",
          "isBlocked", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW(), NOW())`,
        [
          partnerId,
          data.name,
          slug,
          data.type,
          data.address,
          data.latitude,
          data.longitude,
          data.phone || null,
          email || null,
          data.specialties || [],
          data.photoUrl || null,
          data.cnpj || null,
          data.companyName || null,
          data.tradingName || null,
          data.stateRegistration || null,
          data.maxServiceRadius || null,
          data.avgPreparationTime || null,
          data.operatingHours ? JSON.stringify(data.operatingHours) : null,
          false, // isBlocked
        ]
      );

      // 2. Criar usuário associado (se email fornecido)
      if (email) {
        const userId = generateId();
        const walletId = generateId();
        const hashedPassword = await bcrypt.hash(data.password!.trim(), 10);

        // Criar usuário
        await client.query(
          `INSERT INTO "User" (
            id, name, email, password, age, "photoUrl", "pilotProfile", role, "partnerId",
            "isSubscriber", "subscriptionType", "loyaltyPoints",
            "currentLat", "currentLng", "isOnline", "createdAt", "updatedAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())`,
          [
            userId,
            data.name, // Nome do lojista
            email,
            hashedPassword,
            25, // Idade padrão (pode ser ajustada)
            data.photoUrl || null,
            'URBANO', // PilotProfile padrão (não usado para lojistas)
            UserRole.USER, // Role padrão
            partnerId, // Vincular ao parceiro
            false,
            'standard',
            0,
            null,
            null,
            false,
          ]
        );

        // Criar wallet para o usuário
        await client.query(
          `INSERT INTO "Wallet" (id, "userId", balance, "totalEarned", "totalWithdrawn", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
          [walletId, userId, 0, 0, 0]
        );
      }
    });

    const partner = await queryOne<Partner>(
      'SELECT * FROM "Partner" WHERE id = $1',
      [partnerId]
    );

    return partner;
  }

  /**
   * Listar parceiros com filtros
   */
  async listPartners(filters?: {
    type?: string;
    isBlocked?: boolean;
    isTrusted?: boolean;
    limit?: number;
    offset?: number;
  }) {
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (filters?.type) {
      whereClause += ` AND type = $${paramIndex}`;
      params.push(filters.type);
      paramIndex++;
    }

    if (filters?.isBlocked !== undefined) {
      whereClause += ` AND "isBlocked" = $${paramIndex}`;
      params.push(filters.isBlocked);
      paramIndex++;
    }

    if (filters?.isTrusted !== undefined) {
      whereClause += ` AND "isTrusted" = $${paramIndex}`;
      params.push(filters.isTrusted);
      paramIndex++;
    }

    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;

    const partners = await query<Partner>(
      `SELECT * FROM "Partner" 
       ${whereClause}
       ORDER BY "createdAt" DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    const totalResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM "Partner" ${whereClause}`,
      params
    );

    const total = totalResult ? parseInt(totalResult.count) : 0;

    return { partners, total };
  }

  /**
   * Buscar parceiro por ID (com informações de pagamento)
   */
  async getPartnerById(partnerId: string) {
    const partner = await queryOne<
      Partner & {
        payment: PartnerPayment | null;
        linked_users: Array<{ id: string; name: string; email: string | null }> | null;
      }
    >(
      `SELECT 
        p.*,
        CASE 
          WHEN pp.id IS NOT NULL THEN json_build_object(
            'id', pp.id,
            'partnerId', pp."partnerId",
            'planType', pp."planType",
            'monthlyFee', pp."monthlyFee",
            'percentageFee', pp."percentageFee",
            'status', pp.status,
            'dueDate', pp."dueDate",
            'lastPaymentDate', pp."lastPaymentDate",
            'paymentHistory', pp."paymentHistory",
            'createdAt', pp."createdAt",
            'updatedAt', pp."updatedAt"
          )
          ELSE NULL
        END as payment,
        (
          SELECT COALESCE(
            json_agg(
              json_build_object('id', u.id, 'name', u.name, 'email', u.email)
              ORDER BY u.email
            ),
            '[]'::json
          )
          FROM "User" u
          WHERE u."partnerId" = p.id
        ) as linked_users
       FROM "Partner" p
       LEFT JOIN "PartnerPayment" pp ON pp."partnerId" = p.id AND pp.status = 'ACTIVE'
       WHERE p.id = $1`,
      [partnerId]
    );

    return partner;
  }

  /**
   * Atualizar parceiro
   */
  async updatePartner(partnerId: string, data: UpdatePartnerDto) {
    const updateFields: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updateFields.push(`name = $${paramIndex}`);
      params.push(data.name);
      paramIndex++;
    }

    if (data.address !== undefined) {
      updateFields.push(`address = $${paramIndex}`);
      params.push(data.address);
      paramIndex++;
    }

    if (data.latitude !== undefined) {
      updateFields.push(`latitude = $${paramIndex}`);
      params.push(data.latitude);
      paramIndex++;
    }

    if (data.longitude !== undefined) {
      updateFields.push(`longitude = $${paramIndex}`);
      params.push(data.longitude);
      paramIndex++;
    }

    if (data.phone !== undefined) {
      updateFields.push(`phone = $${paramIndex}`);
      params.push(data.phone);
      paramIndex++;
    }

    if (data.email !== undefined) {
      updateFields.push(`email = $${paramIndex}`);
      params.push(data.email);
      paramIndex++;
    }

    if (data.specialties !== undefined) {
      updateFields.push(`specialties = $${paramIndex}`);
      params.push(data.specialties);
      paramIndex++;
    }

    if (data.photoUrl !== undefined) {
      updateFields.push(`"photoUrl" = $${paramIndex}`);
      params.push(data.photoUrl);
      paramIndex++;
    }

    if (data.cnpj !== undefined) {
      updateFields.push(`cnpj = $${paramIndex}`);
      params.push(data.cnpj);
      paramIndex++;
    }

    if (data.companyName !== undefined) {
      updateFields.push(`"companyName" = $${paramIndex}`);
      params.push(data.companyName);
      paramIndex++;
    }

    if (data.tradingName !== undefined) {
      updateFields.push(`"tradingName" = $${paramIndex}`);
      params.push(data.tradingName);
      paramIndex++;
    }

    if (data.stateRegistration !== undefined) {
      updateFields.push(`"stateRegistration" = $${paramIndex}`);
      params.push(data.stateRegistration);
      paramIndex++;
    }

    if (data.maxServiceRadius !== undefined) {
      updateFields.push(`"maxServiceRadius" = $${paramIndex}`);
      params.push(data.maxServiceRadius);
      paramIndex++;
    }

    if (data.avgPreparationTime !== undefined) {
      updateFields.push(`"avgPreparationTime" = $${paramIndex}`);
      params.push(data.avgPreparationTime);
      paramIndex++;
    }

    if (data.operatingHours !== undefined) {
      updateFields.push(`"operatingHours" = $${paramIndex}`);
      params.push(data.operatingHours ? JSON.stringify(data.operatingHours) : null);
      paramIndex++;
    }

    if (data.isBlocked !== undefined) {
      updateFields.push(`"isBlocked" = $${paramIndex}`);
      params.push(data.isBlocked);
      paramIndex++;
    }

    if (updateFields.length === 0) {
      throw new Error('Nenhum campo para atualizar');
    }

    updateFields.push(`"updatedAt" = NOW()`);
    params.push(partnerId);

    await query(
      `UPDATE "Partner" 
       SET ${updateFields.join(', ')}
       WHERE id = $${paramIndex}`,
      params
    );

    const updatedPartner = await queryOne<Partner>(
      'SELECT * FROM "Partner" WHERE id = $1',
      [partnerId]
    );

    return updatedPartner;
  }

  /**
   * Criar plano de pagamento para parceiro
   */
  async createPaymentPlan(data: CreatePartnerPaymentDto) {
    // Verificar se parceiro existe
    const partner = await queryOne<Partner>(
      'SELECT id FROM "Partner" WHERE id = $1',
      [data.partnerId]
    );

    if (!partner) {
      throw new Error('Parceiro não encontrado');
    }

    // Validar campos baseados no tipo de plano
    if (data.planType === PaymentPlanType.MONTHLY_SUBSCRIPTION && !data.monthlyFee) {
      throw new Error('monthlyFee é obrigatório para plano mensal');
    }

    if (data.planType === PaymentPlanType.PERCENTAGE_PER_ORDER && !data.percentageFee) {
      throw new Error('percentageFee é obrigatório para plano por percentual');
    }

    // Desativar plano anterior se existir
    await query(
      `UPDATE "PartnerPayment" 
       SET status = $1, "updatedAt" = NOW()
       WHERE "partnerId" = $2 AND status = $3`,
      [PaymentStatus.SUSPENDED, data.partnerId, PaymentStatus.ACTIVE]
    );

    const paymentId = generateId();

    await query(
      `INSERT INTO "PartnerPayment" (
        id, "partnerId", "planType", "monthlyFee", "percentageFee",
        status, "dueDate", "paymentHistory", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
      [
        paymentId,
        data.partnerId,
        data.planType,
        data.monthlyFee || null,
        data.percentageFee || null,
        PaymentStatus.ACTIVE,
        data.dueDate || null,
        JSON.stringify([]), // paymentHistory vazio inicialmente
      ]
    );

    const payment = await queryOne<PartnerPayment>(
      'SELECT * FROM "PartnerPayment" WHERE id = $1',
      [paymentId]
    );

    return payment;
  }

  /**
   * Atualizar plano de pagamento
   */
  async updatePaymentPlan(paymentId: string, data: UpdatePartnerPaymentDto) {
    const updateFields: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (data.planType !== undefined) {
      updateFields.push(`"planType" = $${paramIndex}`);
      params.push(data.planType);
      paramIndex++;
    }

    if (data.monthlyFee !== undefined) {
      updateFields.push(`"monthlyFee" = $${paramIndex}`);
      params.push(data.monthlyFee);
      paramIndex++;
    }

    if (data.percentageFee !== undefined) {
      updateFields.push(`"percentageFee" = $${paramIndex}`);
      params.push(data.percentageFee);
      paramIndex++;
    }

    if (data.status !== undefined) {
      updateFields.push(`status = $${paramIndex}`);
      params.push(data.status);
      paramIndex++;

      // Se mudou para OVERDUE ou SUSPENDED, bloquear parceiro
      if (data.status === PaymentStatus.OVERDUE || data.status === PaymentStatus.SUSPENDED) {
        const payment = await queryOne<PartnerPayment>(
          'SELECT "partnerId" FROM "PartnerPayment" WHERE id = $1',
          [paymentId]
        );
        if (payment) {
          await query(
            `UPDATE "Partner" SET "isBlocked" = true, "updatedAt" = NOW() WHERE id = $1`,
            [payment.partnerId]
          );
        }
      }

      // Se mudou para ACTIVE, desbloquear parceiro
      if (data.status === PaymentStatus.ACTIVE) {
        const payment = await queryOne<PartnerPayment>(
          'SELECT "partnerId" FROM "PartnerPayment" WHERE id = $1',
          [paymentId]
        );
        if (payment) {
          await query(
            `UPDATE "Partner" SET "isBlocked" = false, "updatedAt" = NOW() WHERE id = $1`,
            [payment.partnerId]
          );
        }
      }
    }

    if (data.dueDate !== undefined) {
      updateFields.push(`"dueDate" = $${paramIndex}`);
      params.push(data.dueDate);
      paramIndex++;
    }

    if (updateFields.length === 0) {
      throw new Error('Nenhum campo para atualizar');
    }

    updateFields.push(`"updatedAt" = NOW()`);
    params.push(paymentId);

    await query(
      `UPDATE "PartnerPayment" 
       SET ${updateFields.join(', ')}
       WHERE id = $${paramIndex}`,
      params
    );

    const updatedPayment = await queryOne<PartnerPayment>(
      'SELECT * FROM "PartnerPayment" WHERE id = $1',
      [paymentId]
    );

    return updatedPayment;
  }

  /**
   * Registrar pagamento
   */
  async recordPayment(paymentId: string, data: RecordPaymentDto) {
    const payment = await queryOne<PartnerPayment>(
      'SELECT * FROM "PartnerPayment" WHERE id = $1',
      [paymentId]
    );

    if (!payment) {
      throw new Error('Plano de pagamento não encontrado');
    }

    // Atualizar histórico de pagamentos
    const paymentHistory = Array.isArray(payment.paymentHistory)
      ? payment.paymentHistory
      : [];

    const newPayment = {
      date: data.paymentDate.toISOString(),
      amount: data.amount,
      description: data.description || 'Pagamento registrado',
      status: 'completed',
    };

    paymentHistory.push(newPayment);

    // Atualizar status e datas
    await query(
      `UPDATE "PartnerPayment" 
       SET "lastPaymentDate" = $1,
           "paymentHistory" = $2,
           status = $3,
           "updatedAt" = NOW()
       WHERE id = $4`,
      [
        data.paymentDate,
        JSON.stringify(paymentHistory),
        PaymentStatus.ACTIVE, // Volta para ACTIVE após pagamento
        paymentId,
      ]
    );

    // Desbloquear parceiro se estava bloqueado
    await query(
      `UPDATE "Partner" SET "isBlocked" = false, "updatedAt" = NOW() WHERE id = $1`,
      [payment.partnerId]
    );

    const updatedPayment = await queryOne<PartnerPayment>(
      'SELECT * FROM "PartnerPayment" WHERE id = $1',
      [paymentId]
    );

    return updatedPayment;
  }

  /**
   * Buscar plano de pagamento por ID
   */
  async getPaymentPlanById(paymentId: string) {
    const payment = await queryOne<PartnerPayment & { partner: Partial<Partner> }>(
      `SELECT 
        pp.*,
        json_build_object(
          'id', p.id,
          'name', p.name,
          'cnpj', p.cnpj
        ) as partner
       FROM "PartnerPayment" pp
       JOIN "Partner" p ON p.id = pp."partnerId"
       WHERE pp.id = $1`,
      [paymentId]
    );

    return payment;
  }

  /**
   * Listar parceiros inadimplentes
   */
  async getOverduePartners() {
    const partners = await query<Partner & { payment: PartnerPayment }>(
      `SELECT 
        p.*,
        json_build_object(
          'id', pp.id,
          'planType', pp."planType",
          'status', pp.status,
          'dueDate', pp."dueDate",
          'lastPaymentDate', pp."lastPaymentDate"
        ) as payment
       FROM "Partner" p
       JOIN "PartnerPayment" pp ON pp."partnerId" = p.id
       WHERE pp.status = $1
       ORDER BY pp."dueDate" ASC`,
      [PaymentStatus.OVERDUE]
    );

    return partners;
  }
}
