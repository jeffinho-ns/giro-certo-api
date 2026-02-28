const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL não definida. Crie um ficheiro .env com DATABASE_URL ou exporte a variável.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('render.com') ? { rejectUnauthorized: false } : false,
});

const sqlPath = path.join(__dirname, 'migrate-alert-types-post-social.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

pool
  .query(sql)
  .then(() => {
    console.log('✅ Migração migrate-alert-types-post-social executada.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Erro:', err.message);
    process.exit(1);
  })
  .finally(() => pool.end());
