import { Router } from 'express';
import { DeliveryController } from '../controllers/delivery.controller';
import { DeliveryPaymentController } from '../controllers/delivery-payment.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();
const deliveryController = new DeliveryController();
const deliveryPaymentController = new DeliveryPaymentController();

// Rotas públicas
router.get('/matching', deliveryController.findMatchingRiders.bind(deliveryController));
router.get('/', deliveryController.listOrders.bind(deliveryController));
router.get('/:orderId', deliveryController.getOrderById.bind(deliveryController));
router.get('/:orderId/route-history', authenticateToken, deliveryController.getOrderRouteHistory.bind(deliveryController));

// Rotas autenticadas
router.post('/quote', authenticateToken, deliveryController.quote.bind(deliveryController));
router.post(
  '/:orderId/payments/initiate',
  authenticateToken,
  deliveryPaymentController.initiate.bind(deliveryPaymentController)
);
router.get(
  '/:orderId/payments/latest',
  authenticateToken,
  deliveryPaymentController.latest.bind(deliveryPaymentController)
);
router.post(
  '/webhook/whatsapp-order',
  authenticateToken,
  deliveryController.createWhatsAppOrder.bind(deliveryController)
);
router.post('/', authenticateToken, deliveryController.createOrder.bind(deliveryController));
router.post('/:orderId/accept', authenticateToken, deliveryController.acceptOrder.bind(deliveryController));
router.post('/:orderId/dispatch', authenticateToken, deliveryController.dispatchOrder.bind(deliveryController));
router.patch('/:orderId/status', authenticateToken, deliveryController.updateOrderStatus.bind(deliveryController));

export default router;
