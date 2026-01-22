const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
require('dotenv').config();

// URL do banco de dados do Render
const DATABASE_URL = process.env.DATABASE_URL || 
  'postgresql://ciro_certo_db_user:Ocmeex5f2qUViao967jipLoAzsEDVzM5@dpg-d5oq5dpr0fns73afoq50-a.oregon-postgres.render.com/ciro_certo_db';

// Converter URL do Prisma para formato PostgreSQL se necessário
let connectionString = DATABASE_URL;
if (connectionString.startsWith('prisma+')) {
  connectionString = 'postgresql://ciro_certo_db_user:Ocmeex5f2qUViao967jipLoAzsEDVzM5@dpg-d5oq5dpr0fns73afoq50-a.oregon-postgres.render.com/ciro_certo_db';
}

const pool = new Pool({
  connectionString: connectionString,
  ssl: connectionString.includes('render.com') ? { rejectUnauthorized: false } : false,
});

async function resetPassword() {
  const email = 'jeffersonlima@ideiaum.com.br';
  const password = '@123Mudar';

  try {
    console.log('🔄 Resetando senha do usuário admin...');
    
    // Gerar hash da senha
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Atualizar senha
    await pool.query(
      `UPDATE "User" SET password = $1, "updatedAt" = NOW() WHERE email = $2`,
      [hashedPassword, email]
    );
    
    console.log('✅ Senha resetada com sucesso!');
    console.log(`📧 Email: ${email}`);
    console.log(`🔑 Nova senha: ${password}`);
  } catch (error) {
    console.error('❌ Erro ao resetar senha:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

resetPassword();
