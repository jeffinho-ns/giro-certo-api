import { query, queryOne, transaction } from '../lib/db';
import { CreateDeliveryOrderDto, UpdateDeliveryStatusDto, MatchingCriteria, DeliveryStatus, DeliveryOrder, User, Partner, Wallet, TransactionType, TransactionStatus } from '../types';
import { calculateDistance } from '../utils/haversine';
import { generateId } from '../utils/id';

export class DeliveryService {
  /**
   * Criar um novo pedido de delivery
   * Calcula automaticamente a comissão baseada no tipo de assinatura
   */
  async createOrder(data: CreateDeliveryOrderDto) {
    // Buscar loja/parceiro
    const partner = await queryOne<Partner>(
      'SELECT * FROM "Partner" WHERE id = $1',
      [data.storeId]
    );

    if (!partner) {
      throw new Error('Parceiro não encontrado');
    }

    const orderId = generateId();
    const status = DeliveryStatus.pending;
    const priority = data.priority || 'normal';

    // Criar pedido
    await query(
      `INSERT INTO "DeliveryOrder" (
        id, "storeId", "storeName", "storeAddress", "storeLatitude", "storeLongitude",
        "deliveryAddress", "deliveryLatitude", "deliveryLongitude",
        "recipientName", "recipientPhone", notes, value, "deliveryFee",
        "appCommission", status, priority, "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW())`,
      [
        orderId,
        data.storeId,
        data.storeName,
        data.storeAddress,
        data.storeLatitude,
        data.storeLongitude,
        data.deliveryAddress,
        data.deliveryLatitude,
        data.deliveryLongitude,
        data.recipientName || null,
        data.recipientPhone || null,
        data.notes || null,
        data.value,
        data.deliveryFee,
        1.0, // Comissão padrão - será atualizada quando aceito
        status,
        priority,
      ]
    );

    // Buscar pedido criado com parceiro
    const order = await queryOne<DeliveryOrder & { partner: Partner }>(
      `SELECT do.*, 
              json_build_object(
                'id', p.id,
                'name', p.name,
                'type', p.type,
                'address', p.address,
                'latitude', p.latitude,
                'longitude', p.longitude
              ) as partner
       FROM "DeliveryOrder" do
       JOIN "Partner" p ON p.id = do."storeId"
       WHERE do.id = $1`,
      [orderId]
    );

    return order;
  }

  /**
   * Algoritmo de Matching
   * Prioriza: 1. Assinantes Premium -> 2. Proximidade -> 3. Reputação
   */
  async findMatchingRiders(criteria: MatchingCriteria) {
    const { latitude, longitude, radius = 5 } = criteria;

    // Buscar todos os motociclistas online
    const riders = await query<User & { wallet: Wallet; activeOrders: number; averageRating: number }>(
      `SELECT 
        u.*,
        w.* as wallet,
        COUNT(DISTINCT CASE WHEN do.status IN ('accepted', 'inProgress') THEN do.id END) as "activeOrders",
        COALESCE(AVG(r.rating), 0) as "averageRating"
       FROM "User" u
       LEFT JOIN "Wallet" w ON w."userId" = u.id
       LEFT JOIN "DeliveryOrder" do ON do."riderId" = u.id
       LEFT JOIN "Rating" r ON r."userId" = u.id AND r."deliveryOrderId" IS NOT NULL
       WHERE u."isOnline" = true 
         AND u."currentLat" IS NOT NULL 
         AND u."currentLng" IS NOT NULL
       GROUP BY u.id, w.id`
    );

    // Calcular distância e filtrar por raio
    const ridersWithDistance = riders
      .map((rider) => {
        if (!rider.currentLat || !rider.currentLng) return null;
        const distance = calculateDistance(
          latitude,
          longitude,
          rider.currentLat,
          rider.currentLng
        );
        return { rider, distance };
      })
      .filter((r): r is { rider: typeof riders[0]; distance: number } => {
        return r !== null && r.distance <= radius;
      });

    // Ordenar: Premium primeiro, depois por distância, depois por reputação
    ridersWithDistance.sort((a, b) => {
      const aIsPremium = a.rider.isSubscriber && a.rider.subscriptionType === 'premium';
      const bIsPremium = b.rider.isSubscriber && b.rider.subscriptionType === 'premium';

      // 1. Assinantes Premium primeiro
      if (aIsPremium && !bIsPremium) return -1;
      if (!aIsPremium && bIsPremium) return 1;

      // 2. Proximidade (menor distância primeiro)
      if (Math.abs(a.distance - b.distance) > 0.1) {
        return a.distance - b.distance;
      }

      // 3. Reputação (maior média de avaliação primeiro)
      const aRating = a.rider.averageRating || 0;
      const bRating = b.rider.averageRating || 0;
      return bRating - aRating;
    });

    return ridersWithDistance.map(({ rider, distance }) => ({
      id: rider.id,
      name: rider.name,
      email: rider.email,
      distance: parseFloat(distance.toFixed(2)),
      isPremium: rider.isSubscriber && rider.subscriptionType === 'premium',
      averageRating: rider.averageRating || 0,
      activeOrders: rider.activeOrders || 0,
      currentLat: rider.currentLat,
      currentLng: rider.currentLng,
    }));
  }

  /**
   * Aceitar um pedido (motociclista)
   * Atualiza a comissão baseada no tipo de assinatura
   */
  async acceptOrder(orderId: string, riderId: string, riderName: string) {
    // Buscar pedido
    const order = await queryOne<DeliveryOrder>(
      'SELECT * FROM "DeliveryOrder" WHERE id = $1',
      [orderId]
    );

    if (!order) {
      throw new Error('Pedido não encontrado');
    }

    if (order.status !== DeliveryStatus.pending) {
      throw new Error('Pedido não está mais disponível');
    }

    // Buscar motociclista
    const rider = await queryOne<User>(
      'SELECT * FROM "User" WHERE id = $1',
      [riderId]
    );

    if (!rider) {
      throw new Error('Motociclista não encontrado');
    }

    // Calcular comissão: R$ 3,00 para Premium, R$ 1,00 para Standard
    const commission =
      rider.isSubscriber && rider.subscriptionType === 'premium' ? 3.0 : 1.0;

    // Calcular distância total
    const distance = calculateDistance(
      order.storeLatitude,
      order.storeLongitude,
      order.deliveryLatitude,
      order.deliveryLongitude
    );

    // Atualizar pedido
    await query(
      `UPDATE "DeliveryOrder" 
       SET status = $1, "riderId" = $2, "riderName" = $3, 
           "appCommission" = $4, distance = $5, 
           "estimatedTime" = $6, "acceptedAt" = NOW(), "updatedAt" = NOW()
       WHERE id = $7`,
      [
        DeliveryStatus.accepted,
        riderId,
        riderName,
        commission,
        parseFloat(distance.toFixed(2)),
        Math.round(distance * 3), // Estimativa: 3 min/km
        orderId,
      ]
    );

    const updatedOrder = await queryOne<DeliveryOrder>(
      'SELECT * FROM "DeliveryOrder" WHERE id = $1',
      [orderId]
    );

    return updatedOrder;
  }

  /**
   * Atualizar status do pedido
   */
  async updateOrderStatus(orderId: string, data: UpdateDeliveryStatusDto) {
    const order = await queryOne<DeliveryOrder>(
      'SELECT * FROM "DeliveryOrder" WHERE id = $1',
      [orderId]
    );

    if (!order) {
      throw new Error('Pedido não encontrado');
    }

    let updateQuery = 'UPDATE "DeliveryOrder" SET status = $1, "updatedAt" = NOW()';
    const params: any[] = [data.status];

    if (data.status === DeliveryStatus.inProgress) {
      updateQuery += ', "inProgressAt" = NOW()';
    }

    if (data.status === DeliveryStatus.completed) {
      updateQuery += ', "completedAt" = NOW()';

      // Creditar comissão na wallet do motociclista
      if (order.riderId && order.appCommission) {
        await this.creditCommission(order.riderId, order.appCommission, orderId);
        
        // Adicionar pontos de fidelidade (10 pontos por corrida)
        await query(
          'UPDATE "User" SET "loyaltyPoints" = "loyaltyPoints" + 10, "updatedAt" = NOW() WHERE id = $1',
          [order.riderId]
        );
      }
    }

    if (data.status === DeliveryStatus.cancelled) {
      updateQuery += ', "cancelledAt" = NOW()';
    }

    updateQuery += ' WHERE id = $' + (params.length + 1);
    params.push(orderId);

    await query(updateQuery, params);

    const updatedOrder = await queryOne<DeliveryOrder>(
      'SELECT * FROM "DeliveryOrder" WHERE id = $1',
      [orderId]
    );

    return updatedOrder;
  }

  /**
   * Creditar comissão na wallet do motociclista
   */
  private async creditCommission(
    riderId: string,
    amount: number,
    deliveryOrderId: string
  ) {
    await transaction(async (client) => {
      // Buscar wallet
      const wallet = await client.query('SELECT * FROM "Wallet" WHERE "userId" = $1', [riderId]);
      
      if (wallet.rows.length === 0) {
        throw new Error('Wallet não encontrada');
      }

      const walletData = wallet.rows[0];
      const transactionId = generateId();

      // Criar transação de comissão
      await client.query(
        `INSERT INTO "WalletTransaction" (
          id, "walletId", "userId", type, amount, description, status,
          "deliveryOrderId", "createdAt", "completedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
        [
          transactionId,
          walletData.id,
          riderId,
          TransactionType.COMMISSION,
          amount,
          `Comissão da corrida #${deliveryOrderId.slice(0, 8)}`,
          TransactionStatus.completed,
          deliveryOrderId,
        ]
      );

      // Atualizar saldo da wallet
      await client.query(
        `UPDATE "Wallet" 
         SET balance = balance + $1, "totalEarned" = "totalEarned" + $1, "updatedAt" = NOW()
         WHERE id = $2`,
        [amount, walletData.id]
      );
    });
  }

  /**
   * Listar pedidos com filtros
   */
  async listOrders(filters?: {
    status?: DeliveryStatus;
    riderId?: string;
    storeId?: string;
    limit?: number;
    offset?: number;
  }) {
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (filters?.status) {
      whereClause += ` AND status = $${paramIndex}`;
      params.push(filters.status);
      paramIndex++;
    }

    if (filters?.riderId) {
      whereClause += ` AND "riderId" = $${paramIndex}`;
      params.push(filters.riderId);
      paramIndex++;
    }

    if (filters?.storeId) {
      whereClause += ` AND "storeId" = $${paramIndex}`;
      params.push(filters.storeId);
      paramIndex++;
    }

    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;

    const orders = await query<DeliveryOrder & { partner: Partner; rider: Partial<User> }>(
      `SELECT 
        do.*,
        json_build_object(
          'id', p.id,
          'name', p.name,
          'type', p.type,
          'address', p.address
        ) as partner,
        CASE 
          WHEN u.id IS NOT NULL THEN json_build_object('id', u.id, 'name', u.name, 'email', u.email)
          ELSE NULL
        END as rider
       FROM "DeliveryOrder" do
       LEFT JOIN "Partner" p ON p.id = do."storeId"
       LEFT JOIN "User" u ON u.id = do."riderId"
       ${whereClause}
       ORDER BY do."createdAt" DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    const totalResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM "DeliveryOrder" ${whereClause}`,
      params
    );

    const total = totalResult ? parseInt(totalResult.count) : 0;

    return { orders, total };
  }

  /**
   * Buscar pedido por ID
   */
  async getOrderById(orderId: string) {
    const order = await queryOne<DeliveryOrder & { partner: Partner; rider: Partial<User>; tracking: any[] }>(
      `SELECT 
        do.*,
        json_build_object(
          'id', p.id,
          'name', p.name,
          'type', p.type,
          'address', p.address
        ) as partner,
        CASE 
          WHEN u.id IS NOT NULL THEN json_build_object('id', u.id, 'name', u.name, 'email', u.email)
          ELSE NULL
        END as rider,
        COALESCE(
          json_agg(
            json_build_object(
              'id', dt.id,
              'latitude', dt.latitude,
              'longitude', dt.longitude,
              'heading', dt.heading,
              'speed', dt.speed,
              'timestamp', dt.timestamp
            ) ORDER BY dt.timestamp DESC
          ) FILTER (WHERE dt.id IS NOT NULL),
          '[]'::json
        ) as tracking
       FROM "DeliveryOrder" do
       LEFT JOIN "Partner" p ON p.id = do."storeId"
       LEFT JOIN "User" u ON u.id = do."riderId"
       LEFT JOIN "DeliveryTracking" dt ON dt."deliveryOrderId" = do.id
       WHERE do.id = $1
       GROUP BY do.id, p.id, u.id
       LIMIT 10`,
      [orderId]
    );

    if (!order) {
      throw new Error('Pedido não encontrado');
    }

    return order;
  }
}
