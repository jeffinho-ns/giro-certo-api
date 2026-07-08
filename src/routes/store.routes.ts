import { Router } from 'express';
import { authenticateToken, requireModerator } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import { StorePublicController } from '../controllers/store-public.controller';
import { StoreAdminController } from '../controllers/store-admin.controller';
import {
  requireStoreManageAccess,
  setActAsPartnerFromParam,
} from '../middleware/store-manage-auth';
import { registerStoreManageRoutes } from '../utils/register-store-manage-routes';

const router = Router();
const publicCtrl = new StorePublicController();
const adminCtrl = new StoreAdminController();

// ============================================
// /api/store/public/* — vitrine pública (SEM auth), com rate limiting
// ============================================
const readLimiter = rateLimit({ windowMs: 60_000, max: 120, keyPrefix: 'store-public-read' });
const orderLimiter = rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'store-public-order' });

router.get('/public/:slug', readLimiter, publicCtrl.getStorefront);
router.post('/public/:slug/coupon/preview', readLimiter, publicCtrl.previewCoupon);
router.post('/public/:slug/orders', orderLimiter, publicCtrl.createOrder);
router.post('/public/orders/:token/checkout', orderLimiter, publicCtrl.checkout);
router.post('/public/orders/:token/review', orderLimiter, publicCtrl.submitReview);
router.get('/public/orders/:token', readLimiter, publicCtrl.getOrderStatus);
router.get('/public/places/autocomplete', readLimiter, publicCtrl.autocompletePlaces);
router.get('/public/places/details', readLimiter, publicCtrl.placeDetails);

// ============================================
// /api/store/admin/* — painel admin da loja
// ============================================
router.get('/admin/templates', authenticateToken, requireModerator, adminCtrl.listTemplates);
router.get('/admin/:partnerId/readiness', authenticateToken, requireModerator, adminCtrl.getReadiness);
router.get('/admin/:partnerId/stats', authenticateToken, requireModerator, adminCtrl.getStats);
router.post('/admin/:partnerId/apply-template', authenticateToken, requireModerator, adminCtrl.applyTemplate);
router.get('/admin/:partnerId/audit-log', authenticateToken, requireModerator, adminCtrl.getAuditLog);

// Espelho admin das rotas de gestão (/api/store/admin/:partnerId/manage/*)
router.use(
  '/admin/:partnerId/manage',
  authenticateToken,
  requireModerator,
  setActAsPartnerFromParam('partnerId')
);
registerStoreManageRoutes(router, '/admin/:partnerId/manage', { blockManagedWrites: false });

// ============================================
// /api/store/manage/* — área do LOJISTA (ou admin com X-Act-As-Partner)
// ============================================
router.use('/manage', authenticateToken, requireStoreManageAccess);
registerStoreManageRoutes(router, '/manage', { blockManagedWrites: true });

export default router;
