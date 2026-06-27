import { Request, Response } from 'express';
import { StorePublicService } from '../services/store-public.service';
import { StorePaymentService } from '../services/store-payment.service';

const publicService = new StorePublicService();
const paymentService = new StorePaymentService();

/**
 * Controller público da loja virtual (/api/store/public/*). SEM autenticação.
 * Devolve apenas DTOs reduzidos e recalcula todos os valores no servidor.
 */
export class StorePublicController {
  private param(req: Request, key: string): string {
    const value = req.params[key];
    return Array.isArray(value) ? value[0] : value;
  }

  getStorefront = async (req: Request, res: Response) => {
    try {
      const slug = this.param(req, 'slug');
      const storefront = await publicService.getStorefrontBySlug(slug);
      if (!storefront) {
        return res.status(404).json({ error: 'Loja não encontrada' });
      }
      res.json(storefront);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  createOrder = async (req: Request, res: Response) => {
    try {
      const slug = this.param(req, 'slug');
      const result = await publicService.createOrder(slug, req.body);
      res.status(201).json({ order: result });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  checkout = async (req: Request, res: Response) => {
    try {
      const token = this.param(req, 'token');
      const result = await paymentService.initiateCheckout(token, {
        cpf: req.body?.cpf,
        billingType: req.body?.billingType,
      });
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  getOrderStatus = async (req: Request, res: Response) => {
    try {
      const token = this.param(req, 'token');
      const status = await publicService.getOrderStatusByToken(token);
      if (!status) {
        return res.status(404).json({ error: 'Pedido não encontrado' });
      }
      res.json({ order: status });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };
}
