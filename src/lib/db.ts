import { Pool, QueryResult } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render sempre requer SSL
  ssl: {
    rejectUnauthorized: false
  },
});

// Helper para executar queries
export const query = async <T = any>(text: string, params?: any[]): Promise<T[]> => {
  const result: QueryResult<T> = await pool.query(text, params);
  return result.rows;
};

// Helper para executar uma query e retornar uma única linha
export const queryOne = async <T = any>(text: string, params?: any[]): Promise<T | null> => {
  const result: QueryResult<T> = await pool.query(text, params);
  return result.rows[0] || null;
};

// Helper para executar uma query e retornar o número de linhas afetadas
export const execute = async (text: string, params?: any[]): Promise<number> => {
  const result = await pool.query(text, params);
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
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export default pool;
