const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL não definida.');
  process.exit(1);
}

const useSsl =
  process.env.PGSSL === 'true' ||
  DATABASE_URL.includes('render.com') ||
  DATABASE_URL.includes('dpg-');

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

async function run() {
  const client = await pool.connect();
  try {
    const sql = fs.readFileSync(
      path.join(__dirname, 'migrate-delivery-settlement-split-batch-ids.sql'),
      'utf8'
    );
    await client.query(sql);
    console.log('✅ Migração split batch ids aplicada.');
  } catch (e) {
    console.error('❌ Falha:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
