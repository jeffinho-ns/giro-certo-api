import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { StoreCatalogService } from '../services/store-catalog.service';
import { StoreOrderService } from '../services/store-order.service';
import { StoreCouponService } from '../services/store-coupon.service';
import { DeliveryService } from '../services/delivery.service';
import { StoreOrderStatus } from '../types';

const catalogService = new StoreCatalogService();
const orderService = new StoreOrderService();
const couponService = new StoreCouponService();
const deliveryService = new DeliveryService();

/**
 * Controller da área do lojista (/api/store/manage/*).
 * O partnerId vem SEMPRE da sessão (req.user.partnerId), nunca do body/params —
 * é assim que garantimos o isolamento por loja. Use após requireLojista.
 */
export class StoreManageController {
  private partnerId(req: AuthRequest): string {
    const partnerId = req.user?.partnerId;
    if (!partnerId) {
      throw new Error('Usuário sem loja vinculada');
    }
    return String(partnerId);
  }

  private param(req: AuthRequest, key: string): string {
    const value = req.params[key];
    return Array.isArray(value) ? value[0] : value;
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
      res.status(201).json({ category });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  updateCategory = async (req: AuthRequest, res: Response) => {
    try {
      const category = await catalogService.updateCategory(
        this.partnerId(req),
        this.param(req, 'id'),
        req.body
      );
      res.json({ category });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  deleteCategory = async (req: AuthRequest, res: Response) => {
    try {
      await catalogService.deleteCategory(this.partnerId(req), this.param(req, 'id'));
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
      res.status(201).json({ product });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  updateProduct = async (req: AuthRequest, res: Response) => {
    try {
      const product = await catalogService.updateProduct(
        this.partnerId(req),
        this.param(req, 'id'),
        req.body
      );
      res.json({ product });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  deleteProduct = async (req: AuthRequest, res: Response) => {
    try {
      await catalogService.deleteProduct(this.partnerId(req), this.param(req, 'id'));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  // --- Grupos de opção ---

  createOptionGroup = async (req: AuthRequest, res: Response) => {
    try {
      const group = await catalogService.createOptionGroup(
        this.partnerId(req),
        this.param(req, 'productId'),
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
      res.status(201).json({ banner });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  updateBanner = async (req: AuthRequest, res: Response) => {
    try {
      const banner = await catalogService.updateBanner(
        this.partnerId(req),
        this.param(req, 'id'),
        req.body
      );
      res.json({ banner });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  deleteBanner = async (req: AuthRequest, res: Response) => {
    try {
      await catalogService.deleteBanner(this.partnerId(req), this.param(req, 'id'));
      res.json({ ok: true });
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
      res.status(201).json({ coupon });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  updateCoupon = async (req: AuthRequest, res: Response) => {
    try {
      const coupon = await couponService.update(
        this.partnerId(req),
        this.param(req, 'id'),
        req.body
      );
      res.json({ coupon });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  deleteCoupon = async (req: AuthRequest, res: Response) => {
    try {
      await couponService.remove(this.partnerId(req), this.param(req, 'id'));
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
      const appearance = await catalogService.updateAppearance(
        this.partnerId(req),
        req.body
      );
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
      // Oferta em tempo real aos motoboys (mesmo fluxo do despacho atual).
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
      const order = await orderService.rejectOrder(
        this.partnerId(req),
        this.param(req, 'id'),
        req.body?.reason
      );
      res.json({ order });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };
}
