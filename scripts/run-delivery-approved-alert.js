const { Pool } = require('pg');
require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ Erro: DATABASE_URL não está configurada no .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query(
      `DO $$ BEGIN ALTER TYPE "AlertType" ADD VALUE 'DELIVERY_APPROVED'; EXCEPTION WHEN duplicate_object THEN null; END $$`
    );
    console.log('✅ Enum AlertType.DELIVERY_APPROVED adicionado.');
  } catch (e) {
    console.log('⚠️', e.message);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
