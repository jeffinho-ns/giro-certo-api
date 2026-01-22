import { query, queryOne, transaction } from '../lib/db';
import { CreateDeliveryOrderDto, UpdateDeliveryStatusDto, MatchingCriteria, DeliveryStatus, DeliveryOrder, User, Partner, Wallet, TransactionType, TransactionStatus, VehicleType, MaintenanceStatus } from '../types';
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

    // Verificar se parceiro está bloqueado
    if (partner.isBlocked) {
      throw new Error('Parceiro bloqueado. Não é possível criar pedidos. Entre em contato com o suporte.');
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
   * Algoritmo de Matching Inteligente
   * Considera tipo de veículo, distância da corrida, manutenção e calcula ETA
   * Prioriza: 1. Assinantes Premium -> 2. Tipo de veículo adequado -> 3. Proximidade -> 4. Reputação
   */
  async findMatchingRiders(criteria: MatchingCriteria & { 
    storeLatitude?: number; 
    storeLongitude?: number; 
    deliveryLatitude?: number; 
    deliveryLongitude?: number;
  }) {
    const { latitude, longitude, radius = 5, storeLatitude, storeLongitude, deliveryLatitude, deliveryLongitude } = criteria;

    // Calcular distância da corrida completa (se fornecida)
    let deliveryDistance: number | null = null;
    if (storeLatitude && storeLongitude && deliveryLatitude && deliveryLongitude) {
      deliveryDistance = calculateDistance(
        storeLatitude,
        storeLongitude,
        deliveryLatitude,
        deliveryLongitude
      );
    }

    // Buscar todos os entregadores online com informações de veículo e manutenção
    const riders = await query<User & { 
      wallet: Wallet; 
      activeOrders: number; 
      averageRating: number;
      bike: any;
      hasCriticalMaintenance: boolean;
    }>(
      `SELECT 
        u.*,
        w.* as wallet,
        COUNT(DISTINCT CASE WHEN do.status IN ('accepted', 'inProgress') THEN do.id END) as "activeOrders",
        COALESCE(AVG(r.rating), 0) as "averageRating",
        -- Buscar bike principal do entregador
        (
          SELECT json_build_object(
            'id', b.id,
            'vehicleType', b."vehicleType",
            'model', b.model,
            'brand', b.brand
          )
          FROM "Bike" b
          WHERE b."userId" = u.id
          ORDER BY b."createdAt" DESC
          LIMIT 1
        ) as bike,
        -- Verificar se tem manutenção crítica
        EXISTS(
          SELECT 1 FROM "MaintenanceLog" ml
          WHERE ml."userId" = u.id
            AND (ml.status = 'CRITICO' OR ml."wearPercentage" >= 0.9)
        ) as "hasCriticalMaintenance"
       FROM "User" u
       LEFT JOIN "Wallet" w ON w."userId" = u.id
       LEFT JOIN "DeliveryOrder" do ON do."riderId" = u.id
       LEFT JOIN "Rating" r ON r."userId" = u.id AND r."deliveryOrderId" IS NOT NULL
       WHERE u."isOnline" = true 
         AND u."currentLat" IS NOT NULL 
         AND u."currentLng" IS NOT NULL
       GROUP BY u.id, w.id`
    );

    // Calcular distância do entregador até a loja e filtrar por raio
    const ridersWithInfo = riders
      .map((rider) => {
        if (!rider.currentLat || !rider.currentLng) return null;

        // Distância do entregador até a loja
        const distanceToStore = calculateDistance(
          latitude,
          longitude,
          rider.currentLat,
          rider.currentLng
        );

        // Verificar bloqueio por manutenção (a menos que tenha override)
        if (rider.hasCriticalMaintenance && !rider.maintenanceBlockOverride) {
          return null; // Pular entregador com manutenção crítica
        }

        // Obter tipo de veículo (default MOTORCYCLE se não tiver bike)
        const bike = rider.bike || null;
        const vehicleType = bike?.vehicleType || VehicleType.MOTORCYCLE;

        // Se temos distância da corrida, aplicar regras por tipo de veículo
        if (deliveryDistance !== null) {
          if (vehicleType === VehicleType.BICYCLE && deliveryDistance > 3) {
            return null; // Bicicletas só corridas até 3km
          }
          if (vehicleType === VehicleType.MOTORCYCLE && deliveryDistance > 10) {
            return null; // Motos até 10km
          }
        }

        // Calcular ETA baseado no tipo de veículo
        let estimatedTime: number | null = null;
        if (deliveryDistance !== null) {
          const avgSpeed = vehicleType === VehicleType.BICYCLE ? 15 : 30; // km/h
          estimatedTime = Math.round((deliveryDistance / avgSpeed) * 60); // minutos
        }

        return {
          rider,
          distanceToStore,
          vehicleType,
          estimatedTime,
          deliveryDistance: deliveryDistance || null,
        };
      })
      .filter((r): r is NonNullable<typeof r> => {
        if (!r) return false;
        // Filtrar por raio até a loja
        return r.distanceToStore <= radius;
      });

    // Ordenar: Premium primeiro, depois tipo de veículo adequado, depois proximidade, depois reputação
    ridersWithInfo.sort((a, b) => {
      const aIsPremium = a.rider.isSubscriber && a.rider.subscriptionType === 'premium';
      const bIsPremium = b.rider.isSubscriber && b.rider.subscriptionType === 'premium';

      // 1. Assinantes Premium primeiro
      if (aIsPremium && !bIsPremium) return -1;
      if (!aIsPremium && bIsPremium) return 1;

      // 2. Se temos distância da corrida, priorizar veículo adequado
      if (a.deliveryDistance !== null && b.deliveryDistance !== null) {
        // Bicicletas para corridas curtas (≤3km), motos para todas
        const aIsSuitable = a.deliveryDistance <= 3 || a.vehicleType === VehicleType.MOTORCYCLE;
        const bIsSuitable = b.deliveryDistance <= 3 || b.vehicleType === VehicleType.MOTORCYCLE;
        
        if (aIsSuitable && !bIsSuitable) return -1;
        if (!aIsSuitable && bIsSuitable) return 1;

        // Se ambos são adequados, priorizar menor ETA
        if (a.estimatedTime !== null && b.estimatedTime !== null) {
          if (Math.abs(a.estimatedTime - b.estimatedTime) > 2) {
            return a.estimatedTime - b.estimatedTime;
          }
        }
      }

      // 3. Proximidade até a loja (menor distância primeiro)
      if (Math.abs(a.distanceToStore - b.distanceToStore) > 0.1) {
        return a.distanceToStore - b.distanceToStore;
      }

      // 4. Reputação (maior média de avaliação primeiro)
      const aRating = a.rider.averageRating || 0;
      const bRating = b.rider.averageRating || 0;
      return bRating - aRating;
    });

    return ridersWithInfo.map(({ rider, distanceToStore, vehicleType, estimatedTime, deliveryDistance }) => ({
      id: rider.id,
      name: rider.name,
      email: rider.email,
      distance: parseFloat(distanceToStore.toFixed(2)),
      deliveryDistance: deliveryDistance ? parseFloat(deliveryDistance.toFixed(2)) : null,
      vehicleType,
      estimatedTime,
      isPremium: rider.isSubscriber && rider.subscriptionType === 'premium',
      averageRating: rider.averageRating || 0,
      activeOrders: rider.activeOrders || 0,
      currentLat: rider.currentLat,
      currentLng: rider.currentLng,
      hasVerifiedBadge: rider.verificationBadge || false,
    }));
  }

  /**
   * Aceitar um pedido (entregador)
   * Atualiza a comissão baseada no tipo de assinatura
   * Calcula ETA baseado no tipo de veículo
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

    // Buscar entregador com bike
    const rider = await queryOne<User & { bike: any }>(
      `SELECT 
        u.*,
        (
          SELECT json_build_object(
            'id', b.id,
            'vehicleType', b."vehicleType"
          )
          FROM "Bike" b
          WHERE b."userId" = u.id
          ORDER BY b."createdAt" DESC
          LIMIT 1
        ) as bike
       FROM "User" u
       WHERE u.id = $1`,
      [riderId]
    );

    if (!rider) {
      throw new Error('Entregador não encontrado');
    }

    // Verificar bloqueio por manutenção (a menos que tenha override)
    if (!rider.maintenanceBlockOverride) {
      const criticalMaintenance = await queryOne<{ exists: boolean }>(
        `SELECT EXISTS(
          SELECT 1 FROM "MaintenanceLog" ml
          WHERE ml."userId" = $1
            AND (ml.status = 'CRITICO' OR ml."wearPercentage" >= 0.9)
        ) as exists`,
        [riderId]
      );

      if (criticalMaintenance?.exists) {
        throw new Error('Entregador bloqueado por manutenção crítica. Entre em contato com o suporte.');
      }
    }

    // Calcular comissão: R$ 3,00 para Premium, R$ 1,00 para Standard
    const commission =
      rider.isSubscriber && rider.subscriptionType === 'premium' ? 3.0 : 1.0;

    // Calcular distância total da corrida
    const distance = calculateDistance(
      order.storeLatitude,
      order.storeLongitude,
      order.deliveryLatitude,
      order.deliveryLongitude
    );

    // Obter tipo de veículo (default MOTORCYCLE se não tiver bike)
    const vehicleType = rider.bike?.vehicleType || VehicleType.MOTORCYCLE;

    // Calcular ETA baseado no tipo de veículo
    const avgSpeed = vehicleType === VehicleType.BICYCLE ? 15 : 30; // km/h
    const estimatedTime = Math.round((distance / avgSpeed) * 60); // minutos

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
        estimatedTime,
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
