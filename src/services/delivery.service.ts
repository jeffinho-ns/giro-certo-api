import { query, queryOne, transaction } from '../lib/db';
import type { Application } from 'express';
import { CreateDeliveryOrderDto, UpdateDeliveryStatusDto, MatchingCriteria, DeliveryStatus, DeliveryOrder, User, Partner, Wallet, TransactionType, TransactionStatus, VehicleType, MaintenanceStatus, UserRole } from '../types';
import { calculateDistance } from '../utils/haversine';
import { generateId } from '../utils/id';
import { AlertService, AlertSeverity, AlertType } from './alert.service';
import { sendPushToUser } from './fcm.service';
import { DeliveryPricingService } from './delivery-pricing.service';
import { incrementOpsMetric, observeOpsMetric } from '../utils/ops-metrics';
import { ioEmit, ioEmitToRoom } from '../utils/socket-events';
import { GooglePlacesService } from './google-places.service';
import { WhatsAppParser } from '../utils/whatsapp-parser';

export class DeliveryService {
  private readonly alertService = new AlertService();
  private readonly deliveryPricingService = new DeliveryPricingService();
  private readonly googlePlacesService = new GooglePlacesService();
  /**
   * Criar um novo pedido de delivery
   * Calcula automaticamente a comissão baseada no tipo de assinatura
   */
  async createOrder(data: CreateDeliveryOrderDto) {
    const quote = await this.deliveryPricingService.calculateQuote({
      storeLatitude: data.storeLatitude,
      storeLongitude: data.storeLongitude,
      deliveryLatitude: data.deliveryLatitude,
      deliveryLongitude: data.deliveryLongitude,
      priority: data.priority,
      urgentBoost: false,
    });

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
    const status = DeliveryStatus.awaiting_dispatch;
    const priority = data.priority || 'normal';

    // Criar pedido
    await query(
      `INSERT INTO "DeliveryOrder" (
        id, "storeId", "storeName", "storeAddress", "storeLatitude", "storeLongitude",
        "deliveryAddress", "deliveryLatitude", "deliveryLongitude",
        "recipientName", "recipientPhone", notes, value, "deliveryFee",
        "appCommission", status, priority, "createdAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())`,
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
        quote.deliveryFee,
        1.0, // Comissão padrão - será atualizada quando aceito
        status,
        priority,
      ]
    );

    // Buscar pedido criado com parceiro
    const order = await queryOne<DeliveryOrder & { partner: Partner }>(
      `SELECT ord.*, 
              json_build_object(
                'id', p.id,
                'name', p.name,
                'type', p.type,
                'address', p.address,
                'latitude', p.latitude,
                'longitude', p.longitude
              ) as partner
       FROM "DeliveryOrder" ord
       JOIN "Partner" p ON p.id = ord."storeId"
       WHERE ord.id = $1`,
      [orderId]
    );

    if (order) {
      await incrementOpsMetric('orders_created_total');
    }

    return order;
  }

  async createOrderFromWhatsAppText(
    rawText: string,
    storeId: string,
    options?: { value?: number; priority?: CreateDeliveryOrderDto['priority'] }
  ) {
    const parsed = WhatsAppParser.parse(rawText);
    if (!parsed.confirmed) {
      return {
        created: false as const,
        reason: 'confirmation_not_yes' as const,
        parsed,
      };
    }

    const geocoded = await this.geocodeDeliveryAddress(parsed.fullAddress);
    const partner = await queryOne<Partner>(
      'SELECT * FROM "Partner" WHERE id = $1',
      [storeId]
    );
    if (!partner) {
      throw new Error('Parceiro nao encontrado');
    }

    const order = await this.createOrder({
      storeId: partner.id,
      storeName: partner.name,
      storeAddress: partner.address,
      storeLatitude: partner.latitude,
      storeLongitude: partner.longitude,
      deliveryAddress: geocoded.formattedAddress,
      deliveryLatitude: geocoded.latitude,
      deliveryLongitude: geocoded.longitude,
      recipientName: parsed.recipientName,
      recipientPhone: parsed.recipientPhone,
      notes: 'Pedido injetado via WhatsApp (MVP Mágico de Oz).',
      value: Number.isFinite(options?.value) ? Number(options?.value) : 0,
      deliveryFee: 0,
      priority: options?.priority,
    });

    if (!order) {
      throw new Error('Falha ao criar pedido a partir do WhatsApp.');
    }

    return {
      created: true as const,
      order,
      deliveryPin: WhatsAppParser.deriveDeliveryProofPin(parsed.recipientPhone),
      internalCode: this.getInternalCode(order.id),
      parsed,
    };
  }

  async dispatchOrder(orderId: string): Promise<DeliveryOrder> {
    const order = await queryOne<DeliveryOrder>(
      'SELECT * FROM "DeliveryOrder" WHERE id = $1',
      [orderId]
    );

    if (!order) {
      throw new Error('Pedido nao encontrado');
    }

    const currentStatus = this.normalizeOrderStatus(order.status);
    if (currentStatus !== DeliveryStatus.awaiting_dispatch) {
      throw new Error(
        `Status invalido para despacho: ${currentStatus || 'desconhecido'}`
      );
    }

    const updatedRows = await query<DeliveryOrder>(
      `UPDATE "DeliveryOrder"
       SET status = $1
       WHERE id = $2
         AND status = $3
       RETURNING *`,
      [DeliveryStatus.pending, orderId, DeliveryStatus.awaiting_dispatch]
    );

    const updatedOrder = updatedRows[0];
    if (!updatedOrder) {
      throw new Error('Status invalido para despacho: pedido nao esta aguardando despacho');
    }

    return updatedOrder;
  }

  async announceOrderToRiders(order: DeliveryOrder, app?: Application): Promise<void> {
    if (order.status !== DeliveryStatus.pending) {
      return;
    }

    await this.notifyMatchingRidersAboutNewOrder(order);
    if (app) {
      await this.emitLiveDeliveryOffers(app, order);
    }
  }

  private async geocodeDeliveryAddress(address: string) {
    const suggestions = await this.googlePlacesService.autocomplete(address);
    if (suggestions.length === 0) {
      throw new Error('Nao foi possivel geocodificar o endereco informado.');
    }

    const details = await this.googlePlacesService.placeDetails(
      suggestions[0].placeId
    );

    return {
      latitude: details.latitude,
      longitude: details.longitude,
      formattedAddress: details.formattedAddress || address,
    };
  }

  /**
   * MVP: motociclistas (cadastro delivery ou perfil TRABALHO), sem loja, sem bloqueio e sem corrida ativa.
   * Nao exige GPS nem proximidade.
   */
  private async listRiderUserIdsEligibleForOfferBroadcast(limit = 500): Promise<string[]> {
    const rows = await query<{ id: string }>(
      `SELECT u.id
       FROM "User" u
       WHERE u."partnerId" IS NULL
         AND COALESCE(u."deliveryRiderBlocked", false) = false
         AND (
           EXISTS (SELECT 1 FROM "DeliveryRegistration" dr WHERE dr."userId" = u.id)
           OR u."pilotProfile" = 'TRABALHO'
         )
         AND NOT EXISTS (
           SELECT 1 FROM "DeliveryOrder" d
           WHERE d."riderId" = u.id
             AND d.status IN ('accepted','arrivedAtStore','inTransit','inProgress')
         )
       ORDER BY u."updatedAt" DESC NULLS LAST
       LIMIT $1`,
      [limit]
    );
    return rows.map((r) => r.id);
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
        COUNT(DISTINCT CASE WHEN rdo.status IN ('accepted', 'arrivedAtStore', 'inTransit', 'inProgress') THEN rdo.id END) as "activeOrders",
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
       LEFT JOIN "DeliveryOrder" rdo ON rdo."riderId" = u.id
       LEFT JOIN "Rating" r ON r."userId" = u.id AND r."deliveryOrderId" IS NOT NULL
       WHERE (
         u."isOnline" = true
         OR (
           u."lastLocationUpdate" IS NOT NULL
           AND u."lastLocationUpdate" >= NOW() - INTERVAL '30 minutes'
         )
       )
         AND u."currentLat" IS NOT NULL 
         AND u."currentLng" IS NOT NULL
         AND COALESCE(u."deliveryRiderBlocked", false) = false
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
  async acceptOrder(
    orderId: string,
    riderId: string,
    riderName: string,
    idempotencyKey?: string
  ) {
    const scope = `accept:${orderId}:${riderId}`;
    const cached = await this.getIdempotencyResponse(scope, idempotencyKey);
    if (cached) return cached as DeliveryOrder;
    // Buscar pedido
    const order = await queryOne<DeliveryOrder>(
      'SELECT * FROM "DeliveryOrder" WHERE id = $1',
      [orderId]
    );

    if (!order) {
      throw new Error('Pedido não encontrado');
    }

    if (order.status !== DeliveryStatus.pending || order.riderId) {
      await this.handleAcceptanceConflict(orderId, riderId, riderName, order);
      if (order.riderId === riderId && order.status === DeliveryStatus.accepted) {
        return order;
      }
      const conflictError: any = new Error('Pedido já foi aceito por outro entregador.');
      conflictError.code = 'ORDER_ALREADY_ACCEPTED';
      conflictError.details = {
        orderId,
        winnerRiderId: order.riderId || null,
        winnerRiderName: order.riderName || null,
      };
      throw conflictError;
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

    if (rider.deliveryRiderBlocked) {
      throw new Error('Entregador bloqueado para corridas. Entre em contato com o suporte.');
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
    const updatedRows = await query<DeliveryOrder>(
      `UPDATE "DeliveryOrder"
       SET status = $1, "riderId" = $2, "riderName" = $3,
           "appCommission" = $4, distance = $5,
           "estimatedTime" = $6, "acceptedAt" = NOW()
       WHERE id = $7
         AND status = $8
         AND "riderId" IS NULL
       RETURNING *`,
      [
        DeliveryStatus.accepted,
        riderId,
        riderName,
        commission,
        parseFloat(distance.toFixed(2)),
        estimatedTime,
        orderId,
        DeliveryStatus.pending,
      ]
    );

    const updatedOrder = updatedRows[0];
    if (!updatedOrder) {
      const latestOrder = await queryOne<DeliveryOrder>(
        'SELECT * FROM "DeliveryOrder" WHERE id = $1',
        [orderId]
      );
      await this.handleAcceptanceConflict(orderId, riderId, riderName, latestOrder || order);
      const conflictError: any = new Error('Pedido já foi aceito por outro entregador.');
      conflictError.code = 'ORDER_ALREADY_ACCEPTED';
      conflictError.details = {
        orderId,
        winnerRiderId: latestOrder?.riderId || null,
        winnerRiderName: latestOrder?.riderName || null,
      };
      throw conflictError;
    }

    const enrichedOrder = await this.getOrderWithRiderContact(orderId);
    const finalOrder = (enrichedOrder || updatedOrder) as DeliveryOrder;
    if (finalOrder.acceptedAt && finalOrder.createdAt) {
      const seconds =
        (new Date(finalOrder.acceptedAt).getTime() -
          new Date(finalOrder.createdAt).getTime()) /
        1000;
      if (seconds >= 0) {
        await observeOpsMetric('time_to_accept_seconds', seconds);
      }
    }
    await incrementOpsMetric('orders_accepted_total');
    await this.storeIdempotencyResponse(scope, idempotencyKey, finalOrder);
    return finalOrder;
  }

  private async handleAcceptanceConflict(
    orderId: string,
    loserRiderId: string,
    loserRiderName: string,
    currentOrder: Partial<DeliveryOrder> | null
  ): Promise<void> {
    await incrementOpsMetric('acceptance_conflicts_total');
    const winnerRiderId = currentOrder?.riderId || null;
    const winnerRiderName = currentOrder?.riderName || 'outro entregador';

    const message =
      'Esta corrida já foi aceita por outro entregador. Confira novas corridas próximas.';
    await sendPushToUser(
      loserRiderId,
      'Corrida indisponível',
      message,
      {
        type: 'delivery_race_lost',
        orderId,
        winnerRiderId: winnerRiderId || '',
      }
    );

    try {
      await query(
        `INSERT INTO "Dispute" (
          id, "deliveryOrderId", "reportedBy", "disputeType",
          status, description, "locationLogs", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
        [
          generateId(),
          orderId,
          loserRiderId,
          'DELIVERY_ISSUE',
          'OPEN',
          `[RACE_ACCEPTANCE] ${loserRiderName} tentou aceitar após ${winnerRiderName}.`,
          JSON.stringify({
            event: 'RACE_ACCEPTANCE',
            loserRiderId,
            loserRiderName,
            winnerRiderId,
            winnerRiderName,
            at: new Date().toISOString(),
          }),
        ]
      );
    } catch {
      // Melhor esforço: mesmo que a disputa não grave, manter notificação ao usuário.
    }
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

    const actorUserId = data.riderId;
    const currentStatus = order.status;
    const nextStatus = data.status;
    const scope = `status:${orderId}:${nextStatus}:${actorUserId ?? 'unknown'}`;
    const cached = await this.getIdempotencyResponse(scope, data.idempotencyKey);
    if (cached) return cached as DeliveryOrder;

    if (currentStatus === nextStatus) {
      return order;
    }

    const allowedTransitions: Record<string, DeliveryStatus[]> = {
      [DeliveryStatus.awaiting_dispatch]: [DeliveryStatus.cancelled],
      [DeliveryStatus.pending]: [DeliveryStatus.accepted, DeliveryStatus.cancelled],
      [DeliveryStatus.accepted]: [
        DeliveryStatus.arrivedAtStore,
        DeliveryStatus.cancelled,
      ],
      [DeliveryStatus.arrivedAtStore]: [
        DeliveryStatus.inTransit,
        DeliveryStatus.cancelled,
      ],
      [DeliveryStatus.inTransit]: [
        DeliveryStatus.arrivedAtDestination,
        DeliveryStatus.cancelled,
      ],
      [DeliveryStatus.inProgress]: [
        DeliveryStatus.arrivedAtDestination,
        DeliveryStatus.cancelled,
      ],
      [DeliveryStatus.arrivedAtDestination]: [
        DeliveryStatus.completed,
        DeliveryStatus.cancelled,
      ],
      [DeliveryStatus.completed]: [],
      [DeliveryStatus.cancelled]: [],
    };

    const isAllowed = allowedTransitions[currentStatus]?.includes(nextStatus);
    if (!isAllowed) {
      throw new Error(
        `Transição inválida de status: ${currentStatus} -> ${nextStatus}`
      );
    }

    // Segurança: após aceite, somente o rider que aceitou pode avançar o fluxo logístico.
    if (
      [
        DeliveryStatus.arrivedAtStore,
        DeliveryStatus.inTransit,
        DeliveryStatus.arrivedAtDestination,
        DeliveryStatus.completed,
      ].includes(nextStatus) &&
      (!actorUserId || actorUserId !== order.riderId)
    ) {
      throw new Error('Apenas o motociclista responsável pode atualizar este status');
    }

    if (nextStatus === DeliveryStatus.inTransit) {
      const expected = this.getInternalCode(order.id);
      const received = (data.pickupCode || '').trim().toUpperCase();
      if (!received) {
        throw new Error('Informe o codigo de retirada da loja.');
      }
      if (received !== expected) {
        await incrementOpsMetric('pickup_code_validation_failed_total');
        throw new Error('Codigo da loja incorreto');
      }
    }

    if (nextStatus === DeliveryStatus.completed) {
      const expected = this.getExpectedDeliveryProofPin(order);
      const received = (data.deliveryPin || '').replace(/\D/g, '');
      if (received.length !== 4) {
        throw new Error('Informe o PIN de 4 digitos do cliente.');
      }
      if (received !== expected) {
        await incrementOpsMetric('delivery_proof_pin_failed_total');
        throw new Error('PIN do cliente incorreto');
      }
    }

    let updateQuery = 'UPDATE "DeliveryOrder" SET status = $1';
    const params: any[] = [nextStatus];

    if (nextStatus === DeliveryStatus.arrivedAtStore) {
      updateQuery += ', "arrived_at_store_at" = NOW()';
    }

    if (nextStatus === DeliveryStatus.inTransit) {
      updateQuery += ', "in_transit_at" = NOW()';
    }

    if (nextStatus === DeliveryStatus.arrivedAtDestination) {
      updateQuery += ', "arrived_at_destination_at" = NOW()';
    }

    if (nextStatus === DeliveryStatus.inProgress) {
      updateQuery += ', "inProgressAt" = NOW()';
    }

    if (nextStatus === DeliveryStatus.completed) {
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

    if (nextStatus === DeliveryStatus.cancelled) {
      updateQuery += ', "cancelledAt" = NOW()';
      await incrementOpsMetric('orders_cancelled_total', 1, currentStatus);
    }

    updateQuery += ' WHERE id = $' + (params.length + 1);
    params.push(orderId);

    await query(updateQuery, params);

    const updatedOrder = await queryOne<DeliveryOrder>(
      'SELECT * FROM "DeliveryOrder" WHERE id = $1',
      [orderId]
    );

    if (nextStatus === DeliveryStatus.arrivedAtStore && updatedOrder) {
      await this.notifyAdminsRiderArrivedAtStore(updatedOrder);
    }
    if (updatedOrder) {
      await this.notifyOrderStatusPush(updatedOrder);
    }

    if (updatedOrder && nextStatus === DeliveryStatus.completed && updatedOrder.inTransitAt) {
      const seconds =
        (new Date(updatedOrder.completedAt || new Date()).getTime() -
          new Date(updatedOrder.inTransitAt).getTime()) /
        1000;
      if (seconds >= 0) {
        await observeOpsMetric('store_to_client_seconds', seconds);
      }
    }
    if (updatedOrder) {
      await incrementOpsMetric('order_status_transition_total', 1, `${currentStatus}->${nextStatus}`);
      await this.storeIdempotencyResponse(scope, data.idempotencyKey, updatedOrder);
    }
    return updatedOrder;
  }

  private async notifyOrderStatusPush(order: DeliveryOrder): Promise<void> {
    const storeUsers = await query<{ id: string }>(
      `SELECT id FROM "User" WHERE "partnerId" = $1`,
      [order.storeId]
    );
    const recipients = new Set<string>(storeUsers.map((u) => u.id));
    if (order.riderId) recipients.add(order.riderId);
    if (recipients.size === 0) return;

    const statusLabel: Record<string, string> = {
      awaiting_dispatch: 'pedido aguardando despacho',
      accepted: 'corrida aceita',
      arrivedAtStore: 'entregador chegou na loja',
      inTransit: 'entrega em trânsito',
      arrivedAtDestination: 'entregador chegou ao cliente',
      inProgress: 'entrega em andamento',
      completed: 'entrega concluída',
      cancelled: 'entrega cancelada',
      pending: 'pedido pendente',
    };
    const label = statusLabel[order.status] ?? order.status;
    for (const userId of recipients) {
      await sendPushToUser(
        userId,
        'Atualização de entrega',
        `Status atualizado: ${label}.`,
        {
          type: 'delivery_status_changed',
          orderId: order.id,
          status: String(order.status),
        }
      );
    }
  }

  private async notifyAdminsRiderArrivedAtStore(order: DeliveryOrder) {
    const adminUsers = await query<{ id: string }>(
      'SELECT id FROM "User" WHERE role = $1',
      [UserRole.ADMIN]
    );

    if (!adminUsers.length) return;

    await Promise.all(
      adminUsers.map((admin) =>
        this.alertService.createAlert({
          type: AlertType.DELIVERY_ARRIVED_AT_STORE,
          severity: AlertSeverity.MEDIUM,
          title: 'Motociclista chegou ao estabelecimento',
          message: `${order.riderName ?? 'Motociclista'} chegou em ${order.storeName} e aguarda retirada.`,
          userId: admin.id,
          metadata: {
            deliveryOrderId: order.id,
            storeId: order.storeId,
            riderId: order.riderId,
            status: order.status,
          },
        })
      )
    );
  }

  async emitLiveDeliveryOffers(
    app: Application,
    order: DeliveryOrder
  ): Promise<void> {
    if (order.status !== DeliveryStatus.pending) {
      return;
    }

    const offerOrder = this.buildDeliveryOfferOrder(order);
    const routeDistanceKm =
      order.storeLatitude != null &&
      order.storeLongitude != null &&
      order.deliveryLatitude != null &&
      order.deliveryLongitude != null
        ? parseFloat(
            calculateDistance(
              order.storeLatitude,
              order.storeLongitude,
              order.deliveryLatitude,
              order.deliveryLongitude
            ).toFixed(2)
          )
        : null;

    // MVP: broadcast global — todos os clientes ligados recebem (o app do motociclista trata no overlay).
    // Push FCM fica em notifyMatchingRidersAboutNewOrder para nao duplicar quando announceOrderToRiders chama ambos.
    ioEmit(app, 'delivery:new_order_offer', {
      order: offerOrder,
      distanceToStoreKm: null,
      routeDistanceKm,
      expiresInSeconds: 25,
    });
  }

  async replayPendingOffersForRider(
    app: Application,
    riderId: string
  ): Promise<void> {
    const activeOrder = await queryOne<{ id: string }>(
      `SELECT id FROM "DeliveryOrder"
       WHERE "riderId" = $1
         AND status IN ('accepted','arrivedAtStore','inTransit','inProgress')
       LIMIT 1`,
      [riderId]
    );
    if (activeOrder) {
      return;
    }

    const orders = await query<DeliveryOrder>(
      `SELECT * FROM "DeliveryOrder"
       WHERE status = $1
         AND "riderId" IS NULL
       ORDER BY "createdAt" DESC
       LIMIT 8`,
      [DeliveryStatus.pending]
    );

    for (const order of orders) {
      const routeDistanceKm =
        order.storeLatitude != null &&
        order.storeLongitude != null &&
        order.deliveryLatitude != null &&
        order.deliveryLongitude != null
          ? parseFloat(
              calculateDistance(
                order.storeLatitude,
                order.storeLongitude,
                order.deliveryLatitude,
                order.deliveryLongitude
              ).toFixed(2)
            )
          : null;

      ioEmitToRoom(app, `user:${riderId}`, 'delivery:new_order_offer', {
        order: this.buildDeliveryOfferOrder(order),
        distanceToStoreKm: null,
        routeDistanceKm,
        expiresInSeconds: 25,
      });
      return;
    }
  }

  private buildDeliveryOfferOrder(order: DeliveryOrder) {
    return {
      id: order.id,
      storeId: order.storeId,
      storeName: order.storeName,
      storeAddress: order.storeAddress,
      storeLatitude: order.storeLatitude,
      storeLongitude: order.storeLongitude,
      deliveryAddress: order.deliveryAddress,
      deliveryLatitude: order.deliveryLatitude,
      deliveryLongitude: order.deliveryLongitude,
      recipientName: order.recipientName ?? null,
      recipientPhone: order.recipientPhone ?? null,
      notes: order.notes ?? null,
      value: Number(order.value),
      deliveryFee: Number(order.deliveryFee),
      status: order.status,
      priority: order.priority,
      createdAt:
        order.createdAt instanceof Date
          ? order.createdAt.toISOString()
          : order.createdAt,
    };
  }

  private async notifyMatchingRidersAboutNewOrder(
    order: DeliveryOrder
  ): Promise<void> {
    if (order.status !== DeliveryStatus.pending) {
      return;
    }

    const riderIds = await this.listRiderUserIdsEligibleForOfferBroadcast(500);
    if (riderIds.length === 0) return;

    const routeDistanceKm =
      order.storeLatitude != null &&
      order.storeLongitude != null &&
      order.deliveryLatitude != null &&
      order.deliveryLongitude != null
        ? parseFloat(
            calculateDistance(
              order.storeLatitude,
              order.storeLongitude,
              order.deliveryLatitude,
              order.deliveryLongitude
            ).toFixed(2)
          )
        : null;

    const distancePart =
      routeDistanceKm != null
        ? ` • ${routeDistanceKm.toFixed(1)} km`
        : '';
    const body = `${order.storeName} • taxa R$ ${Number(order.deliveryFee).toFixed(2)}${distancePart}`;

    await Promise.all(
      riderIds.map((id) =>
        sendPushToUser(id, 'Nova corrida disponível', body, {
          type: 'delivery_offer',
          orderId: order.id,
          storeId: order.storeId,
          storeName: order.storeName,
          status: String(order.status),
        })
      )
    );
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

    const orders = await query<DeliveryOrder & {
      partner: Partner;
      rider: Partial<User>;
      riderEmail?: string | null;
      riderPhotoUrl?: string | null;
      riderPhone?: string | null;
    }>(
      `SELECT 
        ord.*,
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
        u.email as "riderEmail",
        u."photoUrl" as "riderPhotoUrl",
        (
          SELECT dr."emergencyPhone"
          FROM "DeliveryRegistration" dr
          WHERE dr."userId" = ord."riderId"
          ORDER BY dr."createdAt" DESC
          LIMIT 1
        ) as "riderPhone"
       FROM "DeliveryOrder" ord
       LEFT JOIN "Partner" p ON p.id = ord."storeId"
       LEFT JOIN "User" u ON u.id = ord."riderId"
       ${whereClause}
       ORDER BY ord."createdAt" DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    const totalResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM "DeliveryOrder" ord ${whereClause}`,
      params
    );

    const total = totalResult ? parseInt(totalResult.count) : 0;

    return { orders, total };
  }

  /**
   * Buscar pedido por ID
   */
  async getOrderById(orderId: string) {
    const order = await queryOne<DeliveryOrder & {
      partner: Partner;
      rider: Partial<User>;
      tracking: any[];
      riderEmail?: string | null;
      riderPhotoUrl?: string | null;
      riderPhone?: string | null;
    }>(
      `SELECT 
        ord.*,
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
        u.email as "riderEmail",
        u."photoUrl" as "riderPhotoUrl",
        (
          SELECT dr."emergencyPhone"
          FROM "DeliveryRegistration" dr
          WHERE dr."userId" = ord."riderId"
          ORDER BY dr."createdAt" DESC
          LIMIT 1
        ) as "riderPhone",
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
       FROM "DeliveryOrder" ord
       LEFT JOIN "Partner" p ON p.id = ord."storeId"
       LEFT JOIN "User" u ON u.id = ord."riderId"
       LEFT JOIN "DeliveryTracking" dt ON dt."deliveryOrderId" = ord.id
       WHERE ord.id = $1
       GROUP BY ord.id, p.id, u.id
       LIMIT 10`,
      [orderId]
    );

    if (!order) {
      throw new Error('Pedido não encontrado');
    }

    return order;
  }

  private async getOrderWithRiderContact(orderId: string) {
    return queryOne<DeliveryOrder & {
      riderEmail?: string | null;
      riderPhotoUrl?: string | null;
      riderPhone?: string | null;
    }>(
      `SELECT
        ord.*,
        u.email as "riderEmail",
        u."photoUrl" as "riderPhotoUrl",
        (
          SELECT dr."emergencyPhone"
          FROM "DeliveryRegistration" dr
          WHERE dr."userId" = ord."riderId"
          ORDER BY dr."createdAt" DESC
          LIMIT 1
        ) as "riderPhone"
      FROM "DeliveryOrder" ord
      LEFT JOIN "User" u ON u.id = ord."riderId"
      WHERE ord.id = $1
      LIMIT 1`,
      [orderId]
    );
  }

  async getOrderRouteHistory(orderId: string) {
    const points = await query<{
      latitude: number;
      longitude: number;
      heading: number | null;
      speed: number | null;
      timestamp: Date;
    }>(
      `SELECT latitude, longitude, heading, speed, timestamp
       FROM "DeliveryRouteHistory"
       WHERE "deliveryOrderId" = $1
       ORDER BY timestamp ASC`,
      [orderId]
    );
    return {
      orderId,
      points: points.map((p) => ({
        lat: p.latitude,
        lng: p.longitude,
        heading: p.heading,
        speed: p.speed,
        timestamp: p.timestamp,
      })),
    };
  }

  private normalizeOrderStatus(status: unknown): string {
    return String(status ?? '').trim();
  }

  private getInternalCode(orderId: string): string {
    const compact = (orderId || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    return `GC-${compact.slice(-8)}`;
  }

  private getExpectedDeliveryProofPin(order: DeliveryOrder): string {
    const phoneDigits = (order.recipientPhone || '').replace(/\D/g, '');
    if (phoneDigits.length >= 4) {
      return phoneDigits.slice(-4);
    }

    const idDigits = (order.id || '').replace(/\D/g, '');
    if (idDigits.length >= 4) {
      return idDigits.slice(-4);
    }

    throw new Error(
      'Pedido sem telefone do destinatario para validar a entrega.'
    );
  }

  private async ensureIdempotencyTable(): Promise<void> {
    await query(`
      CREATE TABLE IF NOT EXISTS "DeliveryIdempotency" (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        response JSONB NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(scope, key)
      )
    `);
  }

  private async getIdempotencyResponse(
    scope: string,
    key?: string
  ): Promise<unknown | null> {
    const clean = key?.trim();
    if (!clean) return null;
    await this.ensureIdempotencyTable();
    const row = await queryOne<{ response: unknown }>(
      `SELECT response
       FROM "DeliveryIdempotency"
       WHERE scope = $1 AND key = $2
       LIMIT 1`,
      [scope, clean]
    );
    return row?.response ?? null;
  }

  private async storeIdempotencyResponse(
    scope: string,
    key: string | undefined,
    response: unknown
  ): Promise<void> {
    const clean = key?.trim();
    if (!clean) return;
    await this.ensureIdempotencyTable();
    await query(
      `INSERT INTO "DeliveryIdempotency" (id, scope, key, response, "createdAt")
       VALUES ($1, $2, $3, $4::jsonb, NOW())
       ON CONFLICT (scope, key) DO NOTHING`,
      [generateId(), scope, clean, JSON.stringify(response)]
    );
  }
}
