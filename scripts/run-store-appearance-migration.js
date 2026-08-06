/**
 * Migração de personalização da loja (Partner.storeCoverUrl / storeThemeColor / storeDescription).
 * Loja Virtual — Fase 2.
 */
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
    const sqlPath = path.join(__dirname, 'migrate-store-appearance.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await client.query(sql);
    console.log('✅ Colunas de personalização da loja garantidas.');
  } catch (e) {
    console.error('❌ Falha:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
