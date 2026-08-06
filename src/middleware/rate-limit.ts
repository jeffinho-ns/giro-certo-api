import { Request, Response, NextFunction } from 'express';

/**
 * Rate limiter simples em memória (janela fixa por IP+rota).
 * Suficiente para mitigar abuso nos endpoints públicos da loja virtual
 * (catálogo e criação de pedido) sem adicionar dependências externas.
 *
 * Obs.: por ser em memória, é por instância. Para múltiplas instâncias/escala,
 * migrar para um store compartilhado (ex.: Redis) — anotado como dívida.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Limpeza periódica de buckets expirados (evita vazamento de memória).
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000).unref?.();

function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function rateLimit(options: { windowMs: number; max: number; keyPrefix?: string }) {
  const { windowMs, max, keyPrefix = 'rl' } = options;
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${keyPrefix}:${clientIp(req)}`;
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Muitas requisições. Tente novamente em instantes.' });
    }

    next();
  };
}
