/**
 * Apaga todos os pedidos de delivery e dados dependentes (tracking, histórico de rota).
 * WalletTransaction perde a referência ao pedido (coluna opcional, sem FK).
 * Rating / Dispute: FK com ON DELETE SET NULL.
 *
 * Uso: na pasta giro-certo-api, com DATABASE_URL no .env
 *   node scripts/delete-all-delivery-orders.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL não definido no .env');
  process.exit(1);
}

const useSsl =
  process.env.PGSSL === 'true' ||
  databaseUrl.includes('render.com') ||
  databaseUrl.includes('dpg-');

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

async function tableExists(client, name) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [name]
  );
  return r.rowCount > 0;
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: before } = await client.query(
      'SELECT COUNT(*)::int AS c FROM "DeliveryOrder"'
    );
    const n = before[0].c;
    console.log(`Pedidos antes: ${n}`);

    await client.query(
      `UPDATE "WalletTransaction" SET "deliveryOrderId" = NULL WHERE "deliveryOrderId" IS NOT NULL`
    );

    if (await tableExists(client, 'DeliveryRouteHistory')) {
      await client.query(`DELETE FROM "DeliveryRouteHistory"`);
    }

    await client.query(`DELETE FROM "DeliveryTracking"`);

    await client.query(`DELETE FROM "DeliveryOrder"`);

    const { rows: after } = await client.query(
      'SELECT COUNT(*)::int AS c FROM "DeliveryOrder"'
    );
    console.log(`Pedidos depois: ${after[0].c}`);
    console.log(`Removidos: ${n} pedido(s).`);

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
