/**
 * Valida variáveis críticas em produção. Falha cedo em vez de subir inseguro.
 */
export function assertProductionEnv(): void {
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) return;

  const errors: string[] = [];

  const jwt = process.env.JWT_SECRET?.trim();
  if (!jwt || jwt === 'your-secret-key' || jwt.length < 16) {
    errors.push('JWT_SECRET ausente ou fraco (mín. 16 caracteres, não use o default)');
  }

  if (!process.env.DATABASE_URL?.trim()) {
    errors.push('DATABASE_URL é obrigatória');
  }

  if (!process.env.ASAAS_WEBHOOK_TOKEN?.trim()) {
    errors.push('ASAAS_WEBHOOK_TOKEN é obrigatório em produção (webhook fail-closed)');
  }

  if (!process.env.ASAAS_API_KEY?.trim()) {
    errors.push('ASAAS_API_KEY é obrigatória em produção');
  }

  if (errors.length === 0) return;

  console.error('❌ Ambiente de produção inválido:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
