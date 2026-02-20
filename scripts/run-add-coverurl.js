const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
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
    console.log('🔄 Adicionando coluna coverUrl à tabela User...');
    await client.query(`
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "coverUrl" TEXT;
    `);
    await client.query(`
      COMMENT ON COLUMN "User"."coverUrl" IS 'URL da imagem de capa do perfil (rede social)';
    `);
    console.log('✅ Coluna coverUrl adicionada.');
  } catch (err) {
    if (err.message.includes('already exists')) {
      console.log('⚠️ Coluna coverUrl já existe.');
    } else {
      throw err;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
