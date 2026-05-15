import { Request, Response } from 'express';
import type { Application } from 'express';
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
    const userStoreId = user.partnerId == null ? '' : String(user.partnerId);
    const orderStoreId = String(storeId ?? '');
    if (!userStoreId || userStoreId !== orderStoreId) {
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

  private broadcastOrderLifecycleUpdate(
    app: Application,
    order: { id?: string; storeId?: string }
  ) {
    const payload = this.withInternalCode(order as any);
    const envelope = { order: payload };
    const orderId = typeof order.id === 'string' ? order.id : '';
    const storeId = typeof order.storeId === 'string' ? order.storeId : '';

    ioEmit(app, 'delivery:update', envelope);
    ioEmit(app, 'delivery:status:changed', envelope);
    if (orderId) {
      ioEmitToRoom(app, `order:${orderId}`, 'delivery:update', envelope);
      ioEmitToRoom(app, `order:${orderId}`, 'delivery:status:changed', envelope);
    }
    if (storeId) {
      ioEmitToRoom(app, `store:${storeId}`, 'delivery:update', envelope);
      ioEmitToRoom(app, `store:${storeId}`, 'delivery:status:changed', envelope);
    }
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
      this.broadcastOrderLifecycleUpdate(req.app, orderPlain);
      res.status(201).json(this.withInternalCode(orderPlain));
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

      // Pedido via WhatsApp ja vem confirmado no texto: despacha logo para os motociclistas
      // (o fluxo manual pelo app lojista continua usando POST .../dispatch).
      let orderAfterDispatch = result.order;
      try {
        const dispatched = await deliveryService.dispatchOrder(result.order.id);
        await deliveryService.announceOrderToRiders(dispatched, req.app);
        orderAfterDispatch = {
          ...result.order,
          ...dispatched,
        } as typeof result.order;
      } catch (autoErr: any) {
        console.error('[createWhatsAppOrder] Falha ao despachar ou anunciar pedido', {
          orderId: result.order.id,
          message: autoErr?.message,
        });
      }

      const { partner: _p, ...orderPlain } = orderAfterDispatch as any;
      const payload = this.withInternalCode(orderPlain);
      this.broadcastOrderLifecycleUpdate(req.app, orderPlain);

      res.status(201).json({
        created: true,
        orderId: result.order.id,
        internalCode: result.internalCode,
        deliveryPin: result.deliveryPin,
        status: orderAfterDispatch.status,
        order: payload,
        parsed: result.parsed,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async dispatchOrder(req: AuthRequest, res: Response) {
    const orderId = Array.isArray(req.params.orderId)
      ? req.params.orderId[0]
      : req.params.orderId;

    try {
      const existing = await deliveryService.getOrderById(orderId);
      await this.assertCanManageOrder(req, existing.storeId);

      const order = await deliveryService.dispatchOrder(orderId);
      try {
        await deliveryService.announceOrderToRiders(order, req.app);
      } catch (announceError: any) {
        console.error('[dispatchOrder] Falha ao notificar entregadores', {
          orderId,
          userId: req.userId,
          message: announceError?.message,
        });
      }

      const payload = this.withInternalCode(order as any);
      this.broadcastOrderLifecycleUpdate(req.app, order as any);

      res.json({
        dispatched: true,
        order: payload,
      });
    } catch (error: any) {
      const message = error?.message || 'Erro ao despachar pedido';
      console.error('[dispatchOrder]', {
        orderId,
        userId: req.userId,
        message,
        stack: error?.stack,
      });

      if (message.includes('nao encontrado') || message.includes('não encontrado')) {
        return res.status(404).json({ error: message });
      }
      if (message.includes('permissao') || message.includes('permissão')) {
        return res.status(403).json({ error: message });
      }
      if (message.includes('aguardando despacho') || message.includes('Status invalido')) {
        return res.status(409).json({
          error: message,
          code: 'DISPATCH_INVALID_STATUS',
        });
      }

      return res.status(400).json({ error: message });
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
      this.broadcastOrderLifecycleUpdate(req.app, order as any);
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
      this.broadcastOrderLifecycleUpdate(req.app, order as any);
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
