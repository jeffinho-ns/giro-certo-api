import { Router } from 'express';
import { authenticateToken, requireLojista } from '../middleware/auth';
import { StoreManageController } from '../controllers/store-manage.controller';

const router = Router();
const manage = new StoreManageController();

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
