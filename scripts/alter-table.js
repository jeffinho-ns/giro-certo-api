const fs = require('fs');
const path = require('path');

require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render.com') ? {
    rejectUnauthorized: false
  } : false,
});

async function alterTable() {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '../alter_delivery_registration_table.sql'), 'utf-8');
    
    await pool.query(sql);
    console.log('✅ Tabela DeliveryRegistration alterada com sucesso!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro ao alterar tabela:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

alterTable();
