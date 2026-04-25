import { Request, Response } from 'express';
import { DeliveryService } from '../services/delivery.service';
import {
  CreateDeliveryOrderDto,
  UpdateDeliveryStatusDto,
  MatchingCriteria,
} from '../types';
import { AuthRequest } from '../middleware/auth';
import { getIo, ioEmit } from '../utils/socket-events';

const deliveryService = new DeliveryService();

export class DeliveryController {
  async createOrder(req: Request, res: Response) {
    try {
      const data: CreateDeliveryOrderDto = req.body;
      const order = await deliveryService.createOrder(data);
      const { partner: _p, ...orderPlain } = order as any;
      ioEmit(req.app, 'delivery:update', { order: orderPlain });
      res.status(201).json(orderPlain);
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

      const order = await deliveryService.acceptOrder(orderId, riderId, riderName);
      ioEmit(req.app, 'delivery:status:changed', { order });
      ioEmit(req.app, 'delivery:update', { order });
      res.json(order);
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

      const order = await deliveryService.updateOrderStatus(orderId, data);
      ioEmit(req.app, 'delivery:status:changed', { order });
      ioEmit(req.app, 'delivery:update', { order });
      res.json(order);
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
      res.json(result);
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
      res.json(order);
    } catch (error: any) {
      res.status(404).json({ error: error.message });
    }
  }
}
