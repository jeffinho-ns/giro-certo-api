import prisma from '../lib/prisma';
import { CreateDeliveryOrderDto, UpdateDeliveryStatusDto, MatchingCriteria } from '../types';
import { DeliveryStatus } from '@prisma/client';
import { findNearbyUsers, calculateDistance } from '../utils/haversine';

export class DeliveryService {
  /**
   * Criar um novo pedido de delivery
   * Calcula automaticamente a comissão baseada no tipo de assinatura
   */
  async createOrder(data: CreateDeliveryOrderDto) {
    // Buscar loja/parceiro
    const partner = await prisma.partner.findUnique({
      where: { id: data.storeId },
    });

    if (!partner) {
      throw new Error('Parceiro não encontrado');
    }

    // Criar pedido
    const order = await prisma.deliveryOrder.create({
      data: {
        storeId: data.storeId,
        storeName: data.storeName,
        storeAddress: data.storeAddress,
        storeLatitude: data.storeLatitude,
        storeLongitude: data.storeLongitude,
        deliveryAddress: data.deliveryAddress,
        deliveryLatitude: data.deliveryLatitude,
        deliveryLongitude: data.deliveryLongitude,
        recipientName: data.recipientName,
        recipientPhone: data.recipientPhone,
        notes: data.notes,
        value: data.value,
        deliveryFee: data.deliveryFee,
        appCommission: 1.0, // Comissão padrão - será atualizada quando aceito
        status: DeliveryStatus.pending,
        priority: data.priority || 'normal',
      },
      include: {
        partner: true,
      },
    });

    return order;
  }

  /**
   * Algoritmo de Matching
   * Prioriza: 1. Assinantes Premium -> 2. Proximidade -> 3. Reputação
   */
  async findMatchingRiders(criteria: MatchingCriteria) {
    const { latitude, longitude, radius = 5 } = criteria;

    // Buscar todos os motociclistas online
    const riders = await prisma.user.findMany({
      where: {
        isOnline: true,
        currentLat: { not: null },
        currentLng: { not: null },
      },
      include: {
        wallet: true,
        deliveryOrders: {
          where: {
            status: {
              in: [DeliveryStatus.accepted, DeliveryStatus.inProgress],
            },
          },
        },
        ratings: {
          where: {
            deliveryOrderId: { not: null },
          },
        },
      },
    });

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
      const aRating = this.calculateAverageRating(a.rider.ratings);
      const bRating = this.calculateAverageRating(b.rider.ratings);
      return bRating - aRating;
    });

    return ridersWithDistance.map(({ rider, distance }) => ({
      id: rider.id,
      name: rider.name,
      email: rider.email,
      distance: parseFloat(distance.toFixed(2)),
      isPremium: rider.isSubscriber && rider.subscriptionType === 'premium',
      averageRating: this.calculateAverageRating(rider.ratings),
      activeOrders: rider.deliveryOrders.length,
      currentLat: rider.currentLat,
      currentLng: rider.currentLng,
    }));
  }

  private calculateAverageRating(ratings: any[]): number {
    if (ratings.length === 0) return 0;
    const sum = ratings.reduce((acc, r) => acc + r.rating, 0);
    return sum / ratings.length;
  }

  /**
   * Aceitar um pedido (motociclista)
   * Atualiza a comissão baseada no tipo de assinatura
   */
  async acceptOrder(orderId: string, riderId: string, riderName: string) {
    // Buscar pedido
    const order = await prisma.deliveryOrder.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new Error('Pedido não encontrado');
    }

    if (order.status !== DeliveryStatus.pending) {
      throw new Error('Pedido não está mais disponível');
    }

    // Buscar motociclista
    const rider = await prisma.user.findUnique({
      where: { id: riderId },
    });

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
    const updatedOrder = await prisma.deliveryOrder.update({
      where: { id: orderId },
      data: {
        status: DeliveryStatus.accepted,
        riderId: riderId,
        riderName: riderName,
        appCommission: commission,
        distance: parseFloat(distance.toFixed(2)),
        estimatedTime: Math.round(distance * 3), // Estimativa: 3 min/km
        acceptedAt: new Date(),
      },
    });

    return updatedOrder;
  }

  /**
   * Atualizar status do pedido
   */
  async updateOrderStatus(orderId: string, data: UpdateDeliveryStatusDto) {
    const updateData: any = {
      status: data.status,
    };

    if (data.status === DeliveryStatus.inProgress && !data.riderId) {
      updateData.inProgressAt = new Date();
    }

    if (data.status === DeliveryStatus.completed) {
      updateData.completedAt = new Date();

      // Creditar comissão na wallet do motociclista
      const order = await prisma.deliveryOrder.findUnique({
        where: { id: orderId },
      });

      if (order && order.riderId && order.appCommission) {
        await this.creditCommission(order.riderId, order.appCommission, orderId);
        
        // Adicionar pontos de fidelidade (10 pontos por corrida)
        await prisma.user.update({
          where: { id: order.riderId },
          data: {
            loyaltyPoints: { increment: 10 },
          },
        });
      }
    }

    if (data.status === DeliveryStatus.cancelled) {
      updateData.cancelledAt = new Date();
    }

    const updatedOrder = await prisma.deliveryOrder.update({
      where: { id: orderId },
      data: updateData,
    });

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
    // Buscar wallet
    const wallet = await prisma.wallet.findUnique({
      where: { userId: riderId },
    });

    if (!wallet) {
      throw new Error('Wallet não encontrada');
    }

    // Criar transação de comissão
    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        userId: riderId,
        type: 'COMMISSION',
        amount: amount,
        description: `Comissão da corrida #${deliveryOrderId.slice(0, 8)}`,
        status: 'completed',
        deliveryOrderId: deliveryOrderId,
        completedAt: new Date(),
      },
    });

    // Atualizar saldo da wallet
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { increment: amount },
        totalEarned: { increment: amount },
      },
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
    const where: any = {};

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.riderId) {
      where.riderId = filters.riderId;
    }

    if (filters?.storeId) {
      where.storeId = filters.storeId;
    }

    const [orders, total] = await Promise.all([
      prisma.deliveryOrder.findMany({
        where,
        include: {
          partner: true,
          rider: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: filters?.limit || 50,
        skip: filters?.offset || 0,
      }),
      prisma.deliveryOrder.count({ where }),
    ]);

    return { orders, total };
  }

  /**
   * Buscar pedido por ID
   */
  async getOrderById(orderId: string) {
    const order = await prisma.deliveryOrder.findUnique({
      where: { id: orderId },
      include: {
        partner: true,
        rider: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        tracking: {
          orderBy: { timestamp: 'desc' },
          take: 10,
        },
      },
    });

    if (!order) {
      throw new Error('Pedido não encontrado');
    }

    return order;
  }
}
