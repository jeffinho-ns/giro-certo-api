const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render.com') ? {
    rejectUnauthorized: false
  } : false,
});

async function createTable() {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '../create_delivery_registration_table.sql'), 'utf-8');
    
    await pool.query(sql);
    console.log('✅ Tabela DeliveryRegistration criada com sucesso!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro ao criar tabela:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

createTable();
