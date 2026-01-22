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
      console.error('Login error:', error);
      console.error('Error stack:', error?.stack);
      console.error('Error name:', error?.name);
      
      // Tratar AggregateError
      if (error?.name === 'AggregateError' || error?.constructor?.name === 'AggregateError') {
        const firstError = error?.errors?.[0] || error;
        const errorMessage = firstError?.message || 'Erro de conexão com o banco de dados';
        return res.status(401).json({ error: errorMessage });
      }
      
      const errorMessage = error?.message || error?.toString() || 'Email ou senha inválidos';
      res.status(401).json({ error: errorMessage });
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
