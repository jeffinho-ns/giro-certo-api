import { Router } from 'express';
import { authenticateToken, requireLojista } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import { StoreManageController } from '../controllers/store-manage.controller';
import { StorePublicController } from '../controllers/store-public.controller';

const router = Router();
const manage = new StoreManageController();
const publicCtrl = new StorePublicController();

// ============================================
// /api/store/public/* — vitrine pública (SEM auth), com rate limiting
// ============================================
const readLimiter = rateLimit({ windowMs: 60_000, max: 120, keyPrefix: 'store-public-read' });
const orderLimiter = rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'store-public-order' });

router.get('/public/:slug', readLimiter, publicCtrl.getStorefront);
router.post('/public/:slug/orders', orderLimiter, publicCtrl.createOrder);
router.get('/public/orders/:token', readLimiter, publicCtrl.getOrderStatus);

// ============================================
// /api/store/manage/* — área do LOJISTA
// Toda rota: autenticação + ser lojista (partnerId). Escopo = própria loja.
// (As rotas públicas /api/store/public/* entram no Passo 3.)
// ============================================
router.use('/manage', authenticateToken, requireLojista);

// --- Categorias ---
router.get('/manage/categories', manage.listCategories);
router.post('/manage/categories', manage.createCategory);
router.put('/manage/categories/:id', manage.updateCategory);
router.delete('/manage/categories/:id', manage.deleteCategory);

// --- Produtos (com variações) ---
router.get('/manage/products', manage.listProducts);
router.get('/manage/products/:id', manage.getProduct);
router.post('/manage/products', manage.createProduct);
router.put('/manage/products/:id', manage.updateProduct);
router.delete('/manage/products/:id', manage.deleteProduct);

// --- Grupos de opção (variações) ---
router.post('/manage/products/:productId/option-groups', manage.createOptionGroup);
router.put('/manage/option-groups/:id', manage.updateOptionGroup);
router.delete('/manage/option-groups/:id', manage.deleteOptionGroup);

// --- Opções dentro de um grupo ---
router.post('/manage/option-groups/:groupId/options', manage.createOption);
router.put('/manage/options/:id', manage.updateOption);
router.delete('/manage/options/:id', manage.deleteOption);

// --- Banners / promoções ---
router.get('/manage/banners', manage.listBanners);
router.post('/manage/banners', manage.createBanner);
router.put('/manage/banners/:id', manage.updateBanner);
router.delete('/manage/banners/:id', manage.deleteBanner);

export default router;
