import { Pool, QueryResult } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV === 'production';
const useSsl =
  process.env.PGSSL === 'true' ||
  !!databaseUrl &&
    (databaseUrl.includes('render.com') ||
      databaseUrl.includes('dpg-') ||
      isProduction);

const pool = new Pool({
  connectionString: databaseUrl,
  // Render/produção normalmente exigem SSL mesmo com host interno dpg-*
  ssl: useSsl
    ? {
        rejectUnauthorized: false,
      }
    : false,
  keepAlive: true,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

const isRetryableConnectionError = (error: any) => {
  const msg = String(error?.message ?? '').toLowerCase();
  const code = String(error?.code ?? '').toUpperCase();
  return (
    msg.includes('connection terminated unexpectedly') ||
    msg.includes('terminating connection') ||
    msg.includes('connection reset') ||
    code === '57P01' || // admin_shutdown
    code === '57P02' || // crash_shutdown
    code === 'ECONNRESET'
  );
};

const queryWithRetry = async <T = any>(
  text: string,
  params?: any[],
  attempt = 1
): Promise<QueryResult<T>> => {
  try {
    return await pool.query<T>(text, params);
  } catch (error) {
    if (attempt < 2 && isRetryableConnectionError(error)) {
      return queryWithRetry<T>(text, params, attempt + 1);
    }
    throw error;
  }
};

pool.on('error', (err: any) => {
  console.error('[db] erro inesperado no pool:', err?.message || err);
});

// Helper para executar queries
export const query = async <T = any>(text: string, params?: any[]): Promise<T[]> => {
  const result: QueryResult<T> = await queryWithRetry<T>(text, params);
  return result.rows;
};

// Helper para executar uma query e retornar uma única linha
export const queryOne = async <T = any>(text: string, params?: any[]): Promise<T | null> => {
  const result: QueryResult<T> = await queryWithRetry<T>(text, params);
  return result.rows[0] || null;
};

// Helper para executar uma query e retornar o número de linhas afetadas
export const execute = async (text: string, params?: any[]): Promise<number> => {
  const result = await queryWithRetry(text, params);
  return result.rowCount || 0;
};

// Helper para transações
export const transaction = async <T>(
  callback: (client: any) => Promise<T>
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // conexão pode ter encerrado no meio da transação
    }
    throw error;
  } finally {
    client.release();
  }
};

export default pool;
