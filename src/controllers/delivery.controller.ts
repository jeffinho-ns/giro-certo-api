import { Request, Response } from 'express';
import { DeliveryService } from '../services/delivery.service';
import { CreateDeliveryOrderDto, UpdateDeliveryStatusDto, MatchingCriteria } from '../types';

const deliveryService = new DeliveryService();

export class DeliveryController {
  async createOrder(req: Request, res: Response) {
    try {
      const data: CreateDeliveryOrderDto = req.body;
      const order = await deliveryService.createOrder(data);
      // Retornar apenas campos do pedido (sem partner) para compatibilidade com clientes
      const { partner: _p, ...orderPlain } = order as any;
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
        // Informações opcionais para cálculo inteligente de matching
        storeLatitude: req.query.storeLat ? parseFloat(req.query.storeLat as string) : undefined,
        storeLongitude: req.query.storeLng ? parseFloat(req.query.storeLng as string) : undefined,
        deliveryLatitude: req.query.deliveryLat ? parseFloat(req.query.deliveryLat as string) : undefined,
        deliveryLongitude: req.query.deliveryLng ? parseFloat(req.query.deliveryLng as string) : undefined,
      };

      if (!criteria.latitude || !criteria.longitude) {
        return res.status(400).json({ error: 'Latitude e longitude são obrigatórios' });
      }

      const riders = await deliveryService.findMatchingRiders(criteria);
      res.json({ riders });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async acceptOrder(req: Request, res: Response) {
    try {
      const orderId = Array.isArray(req.params.orderId) ? req.params.orderId[0] : req.params.orderId;
      const { riderId, riderName } = req.body;

      if (!riderId || !riderName) {
        return res.status(400).json({ error: 'riderId e riderName são obrigatórios' });
      }

      const order = await deliveryService.acceptOrder(orderId, riderId, riderName);
      res.json(order);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async updateOrderStatus(req: Request, res: Response) {
    try {
      const orderId = Array.isArray(req.params.orderId) ? req.params.orderId[0] : req.params.orderId;
      const data: UpdateDeliveryStatusDto = req.body;

      const order = await deliveryService.updateOrderStatus(orderId, data);
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
      const orderId = Array.isArray(req.params.orderId) ? req.params.orderId[0] : req.params.orderId;
      const order = await deliveryService.getOrderById(orderId);
      res.json(order);
    } catch (error: any) {
      res.status(404).json({ error: error.message });
    }
  }
}
