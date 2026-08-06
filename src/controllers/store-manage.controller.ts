import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { StoreCatalogService } from '../services/store-catalog.service';
import { StoreOrderService } from '../services/store-order.service';
import { StoreCouponService } from '../services/store-coupon.service';
import { DeliveryService } from '../services/delivery.service';
import { StoreAuditService } from '../services/store-audit.service';
import { notifyLinkedLojistasOfCatalogChange } from '../services/store-lojista-notify.service';
import { StoreOrderStatus } from '../types';

const catalogService = new StoreCatalogService();
const orderService = new StoreOrderService();
const couponService = new StoreCouponService();
const deliveryService = new DeliveryService();
const auditService = new StoreAuditService();

/**
 * Controller da área de gestão de loja (/api/store/manage/* e espelho admin).
 * O partnerId vem da sessão (lojista) ou de act-as (admin).
 */
export class StoreManageController {
  private partnerId(req: AuthRequest): string {
    const partnerId = req.actAsPartnerId || req.user?.partnerId;
    if (!partnerId) {
      throw new Error('Usuário sem loja vinculada');
    }
    return String(partnerId);
  }

  private param(req: AuthRequest, key: string): string {
    const value = req.params[key];
    return Array.isArray(value) ? value[0] : value;
  }

  private actor(req: AuthRequest) {
    return { userId: req.user!.id, role: String(req.user!.role) };
  }

  private async audit(
    req: AuthRequest,
    action: string,
    entityType: string,
    entityId?: string,
    summary?: string
  ) {
    await auditService.logAudit(
      this.partnerId(req),
      this.actor(req),
      action,
      entityType,
      entityId,
      summary
    );
  }

  private async notifyAdminCatalogChange(req: AuthRequest, summary: string, metadata?: Record<string, unknown>) {
    if (!req.adminActAs) return;
    await notifyLinkedLojistasOfCatalogChange(req.app, this.partnerId(req), summary, {
      actorUserId: req.user!.id,
      ...metadata,
    });
  }

  // --- Categorias ---

  listCategories = async (req: AuthRequest, res: Response) => {
    try {
      const categories = await catalogService.listCategories(this.partnerId(req));
      res.json({ categories });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  createCategory = async (req: AuthRequest, res: Response) => {
    try {
      const category = await catalogService.createCategory(this.partnerId(req), req.body);
      await this.audit(req, 'create', 'category', category.id, `Categoria criada: ${category.name}`);
      await this.notifyAdminCatalogChange(req, `Categoria criada: ${category.name}`, {
        entityType: 'category',
        entityId: category.id,
      });
      res.status(201).json({ category });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  updateCategory = async (req: AuthRequest, res: Response) => {
    try {
      const id = this.param(req, 'id');
      const category = await catalogService.updateCategory(this.partnerId(req), id, req.body);
      await this.audit(req, 'update', 'category', id, `Categoria atualizada: ${category.name}`);
      await this.notifyAdminCatalogChange(req, `Categoria atualizada: ${category.name}`, {
        entityType: 'category',
        entityId: id,
      });
      res.json({ category });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  deleteCategory = async (req: AuthRequest, res: Response) => {
    try {
      const id = this.param(req, 'id');
      await catalogService.deleteCategory(this.partnerId(req), id);
      await this.audit(req, 'delete', 'category', id, 'Categoria removida');
      await this.notifyAdminCatalogChange(req, 'Categoria removida', { entityType: 'category', entityId: id });
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  // --- Produtos ---

  listProducts = async (req: AuthRequest, res: Response) => {
    try {
      const filters = {
        categoryId: (req.query.categoryId as string) || undefined,
        active:
          req.query.active === undefined ? undefined : req.query.active === 'true',
      };
      const products = await catalogService.listProducts(this.partnerId(req), filters);
      res.json({ products });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  getProduct = async (req: AuthRequest, res: Response) => {
    try {
      const product = await catalogService.getProduct(
        this.partnerId(req),
        this.param(req, 'id')
      );
      if (!product) {
        return res.status(404).json({ error: 'Produto não encontrado' });
      }
      res.json({ product });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  createProduct = async (req: AuthRequest, res: Response) => {
    try {
      const product = await catalogService.createProduct(this.partnerId(req), req.body);
      await this.audit(req, 'create', 'product', product.id, `Produto criado: ${product.name}`);
      await this.notifyAdminCatalogChange(req, `Produto criado: ${product.name}`, {
        entityType: 'product',
        entityId: product.id,
      });
      res.status(201).json({ product });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  updateProduct = async (req: AuthRequest, res: Response) => {
    try {
      const id = this.param(req, 'id');
      const product = await catalogService.updateProduct(this.partnerId(req), id, req.body);
      await this.audit(req, 'update', 'product', id, `Produto atualizado: ${product.name}`);
      await this.notifyAdminCatalogChange(req, `Produto atualizado: ${product.name}`, {
        entityType: 'product',
        entityId: id,
      });
      res.json({ product });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  deleteProduct = async (req: AuthRequest, res: Response) => {
    try {
      const id = this.param(req, 'id');
      await catalogService.deleteProduct(this.partnerId(req), id);
      await this.audit(req, 'delete', 'product', id, 'Produto removido');
      await this.notifyAdminCatalogChange(req, 'Produto removido', { entityType: 'product', entityId: id });
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  // --- Grupos de opção ---

  createOptionGroup = async (req: AuthRequest, res: Response) => {
    try {
      const productId = this.param(req, 'productId');
      const group = await catalogService.createOptionGroup(
        this.partnerId(req),
        productId,
        req.body
      );
      res.status(201).json({ optionGroup: group });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  updateOptionGroup = async (req: AuthRequest, res: Response) => {
    try {
      const group = await catalogService.updateOptionGroup(
        this.partnerId(req),
        this.param(req, 'id'),
        req.body
      );
      res.json({ optionGroup: group });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  deleteOptionGroup = async (req: AuthRequest, res: Response) => {
    try {
      await catalogService.deleteOptionGroup(this.partnerId(req), this.param(req, 'id'));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  // --- Opções ---

  createOption = async (req: AuthRequest, res: Response) => {
    try {
      const option = await catalogService.createOption(
        this.partnerId(req),
        this.param(req, 'groupId'),
        req.body
      );
      res.status(201).json({ option });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  updateOption = async (req: AuthRequest, res: Response) => {
    try {
      const option = await catalogService.updateOption(
        this.partnerId(req),
        this.param(req, 'id'),
        req.body
      );
      res.json({ option });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  deleteOption = async (req: AuthRequest, res: Response) => {
    try {
      await catalogService.deleteOption(this.partnerId(req), this.param(req, 'id'));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  // --- Banners ---

  listBanners = async (req: AuthRequest, res: Response) => {
    try {
      const banners = await catalogService.listBanners(this.partnerId(req));
      res.json({ banners });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  createBanner = async (req: AuthRequest, res: Response) => {
    try {
      const banner = await catalogService.createBanner(this.partnerId(req), req.body);
      await this.audit(req, 'create', 'banner', banner.id, 'Banner criado');
      await this.notifyAdminCatalogChange(req, 'Banner criado', { entityType: 'banner', entityId: banner.id });
      res.status(201).json({ banner });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  updateBanner = async (req: AuthRequest, res: Response) => {
    try {
      const id = this.param(req, 'id');
      const banner = await catalogService.updateBanner(this.partnerId(req), id, req.body);
      await this.audit(req, 'update', 'banner', id, 'Banner atualizado');
      await this.notifyAdminCatalogChange(req, 'Banner atualizado', { entityType: 'banner', entityId: id });
      res.json({ banner });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  deleteBanner = async (req: AuthRequest, res: Response) => {
    try {
      const id = this.param(req, 'id');
      await catalogService.deleteBanner(this.partnerId(req), id);
      await this.audit(req, 'delete', 'banner', id, 'Banner removido');
      await this.notifyAdminCatalogChange(req, 'Banner removido', { entityType: 'banner', entityId: id });
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  // --- Avaliações recebidas ---

  listReviews = async (req: AuthRequest, res: Response) => {
    try {
      const result = await catalogService.listReviews(this.partnerId(req));
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  // --- Cupons ---

  listCoupons = async (req: AuthRequest, res: Response) => {
    try {
      const coupons = await couponService.list(this.partnerId(req));
      res.json({ coupons });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  createCoupon = async (req: AuthRequest, res: Response) => {
    try {
      const coupon = await couponService.create(this.partnerId(req), req.body);
      await this.audit(req, 'create', 'coupon', coupon.id, `Cupom criado: ${coupon.code}`);
      await this.notifyAdminCatalogChange(req, `Cupom criado: ${coupon.code}`, {
        entityType: 'coupon',
        entityId: coupon.id,
      });
      res.status(201).json({ coupon });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  updateCoupon = async (req: AuthRequest, res: Response) => {
    try {
      const id = this.param(req, 'id');
      const coupon = await couponService.update(this.partnerId(req), id, req.body);
      await this.audit(req, 'update', 'coupon', id, `Cupom atualizado: ${coupon.code}`);
      await this.notifyAdminCatalogChange(req, `Cupom atualizado: ${coupon.code}`, {
        entityType: 'coupon',
        entityId: id,
      });
      res.json({ coupon });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  deleteCoupon = async (req: AuthRequest, res: Response) => {
    try {
      const id = this.param(req, 'id');
      await couponService.remove(this.partnerId(req), id);
      await this.audit(req, 'delete', 'coupon', id, 'Cupom removido');
      await this.notifyAdminCatalogChange(req, 'Cupom removido', { entityType: 'coupon', entityId: id });
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  // --- Personalização da vitrine ---

  getAppearance = async (req: AuthRequest, res: Response) => {
    try {
      const appearance = await catalogService.getAppearance(this.partnerId(req));
      res.json({ appearance });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  updateAppearance = async (req: AuthRequest, res: Response) => {
    try {
      const appearance = await catalogService.updateAppearance(this.partnerId(req), req.body);
      await this.audit(req, 'update', 'appearance', this.partnerId(req), 'Aparência da vitrine atualizada');
      await this.notifyAdminCatalogChange(req, 'Aparência da vitrine atualizada', { entityType: 'appearance' });
      res.json({ appearance });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  // --- Pedidos (loja virtual) ---

  listOrders = async (req: AuthRequest, res: Response) => {
    try {
      const status = req.query.status as StoreOrderStatus | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const orders = await orderService.listOrders(this.partnerId(req), { status, limit });
      res.json({ orders });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  getOrder = async (req: AuthRequest, res: Response) => {
    try {
      const order = await orderService.getOrder(this.partnerId(req), this.param(req, 'id'));
      if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
      res.json({ order });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  acceptOrder = async (req: AuthRequest, res: Response) => {
    try {
      const { storeOrder, deliveryOrder } = await orderService.acceptOrder(
        this.partnerId(req),
        this.param(req, 'id')
      );
      try {
        await deliveryService.announceOrderToRiders(deliveryOrder, req.app);
      } catch (announceError: any) {
        console.error('[store acceptOrder] falha ao notificar entregadores', {
          deliveryOrderId: (deliveryOrder as any)?.id,
          message: announceError?.message,
        });
      }
      res.json({ order: storeOrder, deliveryOrderId: (deliveryOrder as any)?.id });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  rejectOrder = async (req: AuthRequest, res: Response) => {
    try {
      const { order, message } = await orderService.rejectOrder(
        this.partnerId(req),
        this.param(req, 'id'),
        req.body?.reason
      );
      res.json({ order, message });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };
}
