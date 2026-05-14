const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const fallbackDatabaseUrl =
  'postgresql://ciro_certo_db_user:Ocmeex5f2qUViao967jipLoAzsEDVzM5@dpg-d5oq5dpr0fns73afoq50-a.oregon-postgres.render.com/ciro_certo_db';
const DATABASE_URL = process.env.DATABASE_URL || fallbackDatabaseUrl;

if (!DATABASE_URL) {
  console.error('❌ Erro: DATABASE_URL não está configurada.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
});

async function runMigrationFile(client, fileName) {
  const filePath = path.join(__dirname, fileName);
  const sql = fs.readFileSync(filePath, 'utf8');
  await client.query(sql);
  console.log(`✅ Migração aplicada: ${fileName}`);
}

async function run() {
  const client = await pool.connect();
  try {
    console.log('🔄 Executando migração de fluxo logístico granular...\n');
    await runMigrationFile(client, 'migrate-delivery-status-granular.sql');
    await runMigrationFile(client, 'migrate-alert-type-delivery-arrived.sql');
    await runMigrationFile(client, 'migrate-delivery-awaiting-dispatch.sql');
    await runMigrationFile(client, 'migrate-delivery-arrived-at-destination.sql');
    console.log('\n🎉 Migrações de logística concluídas com sucesso.');
  } catch (error) {
    console.error('\n❌ Falha na migração:', error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();

