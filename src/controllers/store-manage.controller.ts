import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { StoreCatalogService } from '../services/store-catalog.service';

const catalogService = new StoreCatalogService();

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
}
