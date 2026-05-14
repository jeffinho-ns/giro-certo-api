import { Request, Response } from 'express';
import { DeliveryService } from '../services/delivery.service';
import {
  CreateDeliveryOrderDto,
  UpdateDeliveryStatusDto,
  MatchingCriteria,
  WhatsAppOrderWebhookDto,
  UserRole,
} from '../types';
import { AuthRequest } from '../middleware/auth';
import { getIo, ioEmit, ioEmitToRoom } from '../utils/socket-events';
import { DeliveryPricingService } from '../services/delivery-pricing.service';

const deliveryService = new DeliveryService();
const deliveryPricingService = new DeliveryPricingService();

export class DeliveryController {
  private resolveStoreId(req: AuthRequest, bodyStoreId?: string): string {
    const user = req.user;
    if (!user) {
      throw new Error('Usuario nao autenticado');
    }

    if (user.role === UserRole.ADMIN) {
      if (!bodyStoreId) {
        throw new Error('storeId obrigatorio para administradores');
      }
      return bodyStoreId;
    }

    if (!user.partnerId) {
      throw new Error('Usuario sem loja associada');
    }

    if (bodyStoreId && bodyStoreId !== user.partnerId) {
      throw new Error('Sem permissao para operar outra loja');
    }

    return user.partnerId;
  }

  private async assertCanManageOrder(req: AuthRequest, storeId: string): Promise<void> {
    const user = req.user;
    if (!user) {
      throw new Error('Usuario nao autenticado');
    }
    if (user.role === UserRole.ADMIN) {
      return;
    }
    if (user.partnerId !== storeId) {
      throw new Error('Sem permissao para operar este pedido');
    }
  }

  private withInternalCode<T extends { id?: string }>(order: T): T & { internalCode: string | null } {
    const rawId = typeof order?.id === 'string' ? order.id : '';
    const compact = rawId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const tail = compact.slice(-8);
    return {
      ...order,
      internalCode: tail ? `GC-${tail}` : null,
    };
  }

  private withInternalCodeList<T extends { id?: string }>(orders: T[]): Array<T & { internalCode: string | null }> {
    return orders.map((o) => this.withInternalCode(o));
  }

  private withoutInternalCode<T extends { internalCode?: string | null }>(order: T): Omit<T, 'internalCode'> {
    const { internalCode: _ignored, ...rest } = order;
    return rest;
  }

  private riderFacingOrder<T extends { id?: string }>(order: T) {
    return this.withoutInternalCode(this.withInternalCode(order));
  }

  private riderFacingOrderList<T extends { id?: string }>(orders: T[]) {
    return orders.map((order) => this.riderFacingOrder(order));
  }

  async quote(req: AuthRequest, res: Response) {
    try {
      const {
        storeLatitude,
        storeLongitude,
        deliveryLatitude,
        deliveryLongitude,
        priority,
        urgentBoost,
      } = req.body || {};
      const quote = await deliveryPricingService.calculateQuote({
        storeLatitude: Number(storeLatitude),
        storeLongitude: Number(storeLongitude),
        deliveryLatitude: Number(deliveryLatitude),
        deliveryLongitude: Number(deliveryLongitude),
        priority: typeof priority === 'string' ? priority : undefined,
        urgentBoost: urgentBoost === true,
      });
      res.json({ quote });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async createOrder(req: Request, res: Response) {
    try {
      const data: CreateDeliveryOrderDto = req.body;
      const order = await deliveryService.createOrder(data);
      const { partner: _p, ...orderPlain } = order as any;
      const payload = this.withInternalCode(orderPlain);
      ioEmit(req.app, 'delivery:update', { order: payload });
      ioEmitToRoom(req.app, `order:${orderPlain.id}`, 'delivery:update', { order: payload });
      res.status(201).json(payload);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async createWhatsAppOrder(req: AuthRequest, res: Response) {
    try {
      const data = req.body as WhatsAppOrderWebhookDto;
      if (!data?.rawText || typeof data.rawText !== 'string') {
        return res.status(400).json({ error: 'rawText obrigatorio' });
      }

      const storeId = this.resolveStoreId(req, data.storeId);
      const result = await deliveryService.createOrderFromWhatsAppText(
        data.rawText,
        storeId,
        {
          value: data.value,
          priority: data.priority,
        }
      );

      if (!result.created) {
        return res.status(200).json({
          created: false,
          reason: result.reason,
          message:
            'Pedido nao criado porque a confirmacao nao foi Sim. Revise o texto e reenvie.',
          parsed: result.parsed,
        });
      }

      const { partner: _p, ...orderPlain } = result.order as any;
      const payload = this.withInternalCode(orderPlain);
      ioEmit(req.app, 'delivery:update', { order: payload });
      ioEmitToRoom(req.app, `order:${orderPlain.id}`, 'delivery:update', { order: payload });

      res.status(201).json({
        created: true,
        orderId: result.order.id,
        internalCode: result.internalCode,
        deliveryPin: result.deliveryPin,
        status: result.order.status,
        order: payload,
        parsed: result.parsed,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async dispatchOrder(req: AuthRequest, res: Response) {
    try {
      const orderId = Array.isArray(req.params.orderId)
        ? req.params.orderId[0]
        : req.params.orderId;
      const existing = await deliveryService.getOrderById(orderId);
      await this.assertCanManageOrder(req, existing.storeId);

      const order = await deliveryService.dispatchOrder(orderId);
      await deliveryService.announceOrderToRiders(order, req.app);

      const payload = this.withInternalCode(order as any);
      ioEmit(req.app, 'delivery:update', { order: payload });
      ioEmitToRoom(req.app, `order:${order.id}`, 'delivery:update', { order: payload });

      res.json({
        dispatched: true,
        order: payload,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async findMatchingRiders(req: Request, res: Response) {
    try {
      const criteria: MatchingCriteria & {
        storeLatitude?: number;
        storeLongitude?: number;
        deliveryLatitude?: number;
        deliveryLongitude?: number;
      } = {
        latitude: parseFloat(req.query.lat as string),
        longitude: parseFloat(req.query.lng as string),
        radius: req.query.radius ? parseFloat(req.query.radius as string) : 5,
        storeLatitude: req.query.storeLat
          ? parseFloat(req.query.storeLat as string)
          : undefined,
        storeLongitude: req.query.storeLng
          ? parseFloat(req.query.storeLng as string)
          : undefined,
        deliveryLatitude: req.query.deliveryLat
          ? parseFloat(req.query.deliveryLat as string)
          : undefined,
        deliveryLongitude: req.query.deliveryLng
          ? parseFloat(req.query.deliveryLng as string)
          : undefined,
      };

      if (!criteria.latitude || !criteria.longitude) {
        return res
          .status(400)
          .json({ error: 'Latitude e longitude são obrigatórios' });
      }

      const riders = await deliveryService.findMatchingRiders(criteria);
      res.json({ riders });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async acceptOrder(req: AuthRequest, res: Response) {
    const orderId = Array.isArray(req.params.orderId)
      ? req.params.orderId[0]
      : req.params.orderId;
    const { riderId, riderName } = req.body || {};
    const idempotencyKey = req.header('x-idempotency-key') || undefined;

    try {
      if (!riderId || !riderName) {
        return res
          .status(400)
          .json({ error: 'riderId e riderName são obrigatórios' });
      }
      if (req.userId && req.userId !== riderId) {
        return res
          .status(403)
          .json({ error: 'Você não pode aceitar corrida em nome de outro usuário' });
      }

      const order = await deliveryService.acceptOrder(
        orderId,
        riderId,
        riderName,
        idempotencyKey
      );
      const payload = this.withInternalCode(order as any);
      ioEmit(req.app, 'delivery:status:changed', { order: payload });
      ioEmit(req.app, 'delivery:update', { order: payload });
      ioEmitToRoom(req.app, `order:${order.id}`, 'delivery:status:changed', { order: payload });
      ioEmitToRoom(req.app, `order:${order.id}`, 'delivery:update', { order: payload });
      res.json(this.riderFacingOrder(order as any));
    } catch (error: any) {
      if (error?.code === 'ORDER_ALREADY_ACCEPTED') {
        const io = getIo(req.app);
        if (io) {
          if (req.userId) {
            io.to(`user:${req.userId}`).emit('delivery:race:lost', {
              orderId,
              message:
                'Esta corrida já foi aceita por outro entregador. Tente outra disponível.',
              winnerRiderId: error?.details?.winnerRiderId ?? null,
              winnerRiderName: error?.details?.winnerRiderName ?? null,
            });
          }
          io.emit('dispute:race', {
            orderId,
            loserRiderId: req.userId ?? riderId,
            loserRiderName: riderName,
            winnerRiderId: error?.details?.winnerRiderId ?? null,
            winnerRiderName: error?.details?.winnerRiderName ?? null,
            at: new Date().toISOString(),
          });
        }

        return res.status(409).json({
          error: 'Pedido já foi aceito por outro entregador.',
          code: 'ORDER_ALREADY_ACCEPTED',
          ...error?.details,
        });
      }
      res.status(400).json({ error: error.message });
    }
  }

  async updateOrderStatus(req: AuthRequest, res: Response) {
    try {
      const orderId = Array.isArray(req.params.orderId)
        ? req.params.orderId[0]
        : req.params.orderId;
      const data: UpdateDeliveryStatusDto = req.body;
      data.riderId = req.userId;
      data.idempotencyKey = req.header('x-idempotency-key') || undefined;

      const order = await deliveryService.updateOrderStatus(orderId, data);
      const payload = this.withInternalCode(order as any);
      ioEmit(req.app, 'delivery:status:changed', { order: payload });
      ioEmit(req.app, 'delivery:update', { order: payload });
      ioEmitToRoom(req.app, `order:${order.id}`, 'delivery:status:changed', { order: payload });
      ioEmitToRoom(req.app, `order:${order.id}`, 'delivery:update', { order: payload });
      res.json(this.riderFacingOrder(order as any));
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async listOrders(req: Request, res: Response) {
    try {
      const filters = {
        status: req.query.status as any,
        riderId: req.query.riderId as string,
        storeId: req.query.storeId as string,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
      };

      const result = await deliveryService.listOrders(filters);
      const orders = filters.storeId
        ? this.withInternalCodeList(result.orders as any[])
        : this.riderFacingOrderList(result.orders as any[]);
      res.json({
        ...result,
        orders,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async getOrderById(req: Request, res: Response) {
    try {
      const orderId = Array.isArray(req.params.orderId)
        ? req.params.orderId[0]
        : req.params.orderId;
      const order = await deliveryService.getOrderById(orderId);
      res.json(this.riderFacingOrder(order as any));
    } catch (error: any) {
      res.status(404).json({ error: error.message });
    }
  }

  async getOrderRouteHistory(req: Request, res: Response) {
    try {
      const orderId = Array.isArray(req.params.orderId)
        ? req.params.orderId[0]
        : req.params.orderId;
      const route = await deliveryService.getOrderRouteHistory(orderId);
      res.json(route);
    } catch (error: any) {
      res.status(404).json({ error: error.message });
    }
  }
}
