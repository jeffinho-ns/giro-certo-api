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

async function setupDatabase() {
  try {
    console.log('🚀 Conectando ao banco de dados...');
    
    // Ler arquivo SQL
    const sqlFile = path.join(__dirname, 'migrate.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');
    
    console.log('📦 Executando migração SQL...');
    
    // Executar SQL
    await pool.query(sql);
    
    console.log('✅ Banco de dados configurado com sucesso!');
    console.log('');
    console.log('📝 Variáveis de ambiente:');
    console.log('DATABASE_URL=postgresql://ciro_certo_db_user:Ocmeex5f2qUViao967jipLoAzsEDVzM5@dpg-d5oq5dpr0fns73afoq50-a.oregon-postgres.render.com/ciro_certo_db');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro ao configurar banco de dados:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

setupDatabase();
