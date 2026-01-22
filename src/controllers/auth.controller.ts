import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { CreateUserDto, LoginDto } from '../types';

const authService = new AuthService();

export class AuthController {
  async register(req: Request, res: Response) {
    try {
      const data: CreateUserDto = req.body;
      const result = await authService.register(data);
      res.status(201).json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async login(req: Request, res: Response) {
    try {
      const data: LoginDto = req.body;
      const result = await authService.login(data);
      res.json(result);
    } catch (error: any) {
      res.status(401).json({ error: error.message });
    }
  }

  async logout(req: any, res: Response) {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Não autenticado' });
      }
      const result = await authService.logout(req.userId);
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
}
