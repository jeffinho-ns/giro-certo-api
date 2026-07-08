import { Router, RequestHandler } from 'express';
import { StoreManageController } from '../controllers/store-manage.controller';
import { blockManagedMarketingWrites } from '../middleware/store-manage-auth';

export interface RegisterStoreManageRoutesOptions {
  /** Aplica bloqueio de marketing em modo giro_managed (rotas do lojista). */
  blockManagedWrites?: boolean;
}

/**
 * Anexa todas as rotas de gestão de loja a um router Express.
 */
export function registerStoreManageRoutes(
  router: Router,
  basePath: string,
  options: RegisterStoreManageRoutesOptions = {}
): void {
  const manage = new StoreManageController();
  const block: RequestHandler[] = options.blockManagedWrites
    ? [blockManagedMarketingWrites]
    : [];

  const p = (suffix: string) =>
    basePath.endsWith('/') ? `${basePath}${suffix.replace(/^\//, '')}` : `${basePath}${suffix}`;

  // --- Categorias ---
  router.get(p('/categories'), manage.listCategories);
  router.post(p('/categories'), ...block, manage.createCategory);
  router.put(p('/categories/:id'), ...block, manage.updateCategory);
  router.delete(p('/categories/:id'), ...block, manage.deleteCategory);

  // --- Produtos ---
  router.get(p('/products'), manage.listProducts);
  router.get(p('/products/:id'), manage.getProduct);
  router.post(p('/products'), ...block, manage.createProduct);
  router.put(p('/products/:id'), ...block, manage.updateProduct);
  router.delete(p('/products/:id'), ...block, manage.deleteProduct);

  // --- Grupos de opção ---
  router.post(p('/products/:productId/option-groups'), ...block, manage.createOptionGroup);
  router.put(p('/option-groups/:id'), ...block, manage.updateOptionGroup);
  router.delete(p('/option-groups/:id'), ...block, manage.deleteOptionGroup);

  // --- Opções ---
  router.post(p('/option-groups/:groupId/options'), ...block, manage.createOption);
  router.put(p('/options/:id'), ...block, manage.updateOption);
  router.delete(p('/options/:id'), ...block, manage.deleteOption);

  // --- Banners ---
  router.get(p('/banners'), manage.listBanners);
  router.post(p('/banners'), ...block, manage.createBanner);
  router.put(p('/banners/:id'), ...block, manage.updateBanner);
  router.delete(p('/banners/:id'), ...block, manage.deleteBanner);

  // --- Avaliações ---
  router.get(p('/reviews'), manage.listReviews);

  // --- Cupons ---
  router.get(p('/coupons'), manage.listCoupons);
  router.post(p('/coupons'), ...block, manage.createCoupon);
  router.put(p('/coupons/:id'), ...block, manage.updateCoupon);
  router.delete(p('/coupons/:id'), ...block, manage.deleteCoupon);

  // --- Aparência ---
  router.get(p('/appearance'), manage.getAppearance);
  router.put(p('/appearance'), ...block, manage.updateAppearance);

  // --- Pedidos (não bloqueados por giro_managed) ---
  router.get(p('/orders'), manage.listOrders);
  router.get(p('/orders/:id'), manage.getOrder);
  router.post(p('/orders/:id/accept'), manage.acceptOrder);
  router.post(p('/orders/:id/reject'), manage.rejectOrder);
}
