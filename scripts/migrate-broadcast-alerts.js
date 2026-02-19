require('dotenv').config();
const { Pool } = require('pg');

const values = [
  'BROADCAST_NEED_HELP',
  'BROADCAST_BIKE_STOPPED',
  'BROADCAST_ACCIDENT',
  'BROADCAST_BLITZ',
];

async function run() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL não definida. Defina no .env ou na variável de ambiente.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('render.com') ? { rejectUnauthorized: false } : undefined,
  });

  try {
    console.log('🚀 A aplicar migração broadcast alerts...');
    for (const value of values) {
      await pool.query(`ALTER TYPE "AlertType" ADD VALUE IF NOT EXISTS '${value}'`);
      console.log('   ✓', value);
    }
    console.log('✅ Migração concluída.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Erro:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
