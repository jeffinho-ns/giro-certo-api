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

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('🔄 Executando migração Follow (rede social)...\n');
    const sqlPath = path.join(__dirname, 'migrate-follow-social.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await client.query(sql);
    console.log('✅ Tabela Follow criada com sucesso.\n');
  } catch (error) {
    if (error.message.includes('already exists')) {
      console.log('⚠️  Tabela Follow já existe. Nada a fazer.\n');
    } else {
      console.error('❌ Erro:', error.message);
      process.exit(1);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
