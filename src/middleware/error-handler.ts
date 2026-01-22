import { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  console.error('Error:', err);

  // Erro de validação do banco de dados
  if (err.code === '23505') {
    // Unique constraint violation
    return res.status(409).json({ error: 'Registro já existe' });
  }

  if (err.code === '23503') {
    // Foreign key constraint violation
    return res.status(400).json({ error: 'Referência inválida' });
  }

  if (err.code === '23502') {
    // Not null constraint violation
    return res.status(400).json({ error: 'Campo obrigatório não fornecido' });
  }

  // Erro de sintaxe SQL
  if (err.code && err.code.startsWith('42')) {
    return res.status(500).json({ error: 'Erro no banco de dados' });
  }

  // Erro padrão
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Erro interno do servidor';

  res.status(status).json({ error: message });
}
