/**
 * Aplica colunas em DeliveryRegistration exigidas pela API atual:
 * - vehicleType (moto / bicicleta)
 * - equipments, bikeOptionalReceiptData (cadastro v2)
 *
 * Uso: node scripts/run-delivery-registration-schema-migrations.js
 * Requer DATABASE_URL no .env (ou variável de ambiente).
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Erro: defina DATABASE_URL no .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
});

async function runFile(client, name) {
  const filePath = path.join(__dirname, name);
  const sql = fs.readFileSync(filePath, 'utf8');
  await client.query(sql);
  console.log(`OK: ${name}`);
}

async function main() {
  const client = await pool.connect();
  try {
    console.log('Aplicando migrações DeliveryRegistration...\n');
    await runFile(client, 'migrate-delivery-registration-vehicle-type.sql');
    await runFile(client, 'migrate-delivery-registration-v2-extras.sql');
    console.log('\nConcluído.');
  } catch (e) {
    console.error('Falha:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
