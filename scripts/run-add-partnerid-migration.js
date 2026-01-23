const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Configurar pool com SSL se necessário (para produção)
const connectionConfig = {
  connectionString: process.env.DATABASE_URL,
};

// Se a URL contém SSL, adicionar configuração SSL
if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require')) {
  connectionConfig.ssl = {
    rejectUnauthorized: false
  };
} else if (process.env.DATABASE_URL && (process.env.DATABASE_URL.includes('render.com') || process.env.DATABASE_URL.includes('onrender.com'))) {
  // Render requer SSL
  connectionConfig.ssl = {
    rejectUnauthorized: false
  };
}

const pool = new Pool(connectionConfig);

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Executando migration: Adicionar partnerId à tabela User...');
    
    const sqlPath = path.join(__dirname, 'migrate-add-partnerid-to-user.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    
    console.log('✅ Migration executada com sucesso!');
    console.log('📝 O campo partnerId foi adicionado à tabela User');
    console.log('🔗 Agora os lojistas podem ser vinculados a usuários automaticamente');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erro ao executar migration:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
