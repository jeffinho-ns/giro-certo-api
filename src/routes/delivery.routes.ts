import { Router } from 'express';
import { DeliveryController } from '../controllers/delivery.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();
const deliveryController = new DeliveryController();

// Rotas públicas
router.get('/matching', deliveryController.findMatchingRiders.bind(deliveryController));
router.get('/', deliveryController.listOrders.bind(deliveryController));
router.get('/:orderId', deliveryController.getOrderById.bind(deliveryController));

// Rotas autenticadas
router.post('/', authenticateToken, deliveryController.createOrder.bind(deliveryController));
router.post('/:orderId/accept', authenticateToken, deliveryController.acceptOrder.bind(deliveryController));
router.patch('/:orderId/status', authenticateToken, deliveryController.updateOrderStatus.bind(deliveryController));

export default router;
