const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Dados de conexão
const pool = new Pool({
  host: 'dpg-d5oq5dpr0fns73afoq50-a.oregon-postgres.render.com',
  port: 5432,
  database: 'ciro_certo_db',
  user: 'ciro_certo_db_user',
  password: 'Ocmeex5f2qUViao967jipLoAzsEDVzM5',
  ssl: {
    rejectUnauthorized: false
  }
});

async function setupImages() {
  try {
    console.log('🚀 Adicionando tabela de imagens...');
    
    // Ler arquivo SQL
    const sqlFile = path.join(__dirname, 'add-images-table.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');
    
    console.log('📦 Executando SQL...');
    
    // Executar SQL
    await pool.query(sql);
    
    console.log('✅ Tabela de imagens criada com sucesso!');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro ao criar tabela de imagens:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

setupImages();
