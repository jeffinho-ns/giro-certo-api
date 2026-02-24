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

const MIGRATIONS = [
  { name: 'Stories', file: 'migrate-stories.sql' },
  { name: 'Stories caption', file: 'migrate-stories-add-caption.sql' },
  { name: 'Chat', file: 'migrate-chat.sql' },
  { name: 'Post Reports', file: 'migrate-post-reports.sql' },
];

async function runMigrations() {
  const client = await pool.connect();
  try {
    console.log('🔄 Executando migrações da rede social...\n');

    for (const m of MIGRATIONS) {
      const sqlPath = path.join(__dirname, m.file);
      if (!fs.existsSync(sqlPath)) {
        console.log(`⚠️  Arquivo ${m.file} não encontrado. Pulando.\n`);
        continue;
      }
      const sql = fs.readFileSync(sqlPath, 'utf8');
      try {
        await client.query(sql);
        console.log(`✅ ${m.name} - migração aplicada.\n`);
      } catch (err) {
        if (err.message?.includes('already exists')) {
          console.log(`⚠️  ${m.name} - tabela(s) já existem. Nada a fazer.\n`);
        } else {
          throw err;
        }
      }
    }

    console.log('✅ Todas as migrações concluídas.\n');
  } catch (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
