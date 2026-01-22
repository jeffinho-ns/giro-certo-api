const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
require('dotenv').config();

// URL do banco de dados do Render
const DATABASE_URL = process.env.DATABASE_URL || 
  'postgresql://ciro_certo_db_user:Ocmeex5f2qUViao967jipLoAzsEDVzM5@dpg-d5oq5dpr0fns73afoq50-a.oregon-postgres.render.com/ciro_certo_db';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: connectionString.includes('render.com') ? { rejectUnauthorized: false } : false,
});

async function testLogin() {
  const email = 'jeffersonlima@ideiaum.com.br';
  const password = '@123Mudar';

  try {
    console.log('🔍 Testando login...');
    
    // Buscar usuário
    const result = await pool.query(
      'SELECT id, name, email, password, role FROM "User" WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      console.log('❌ Usuário não encontrado');
      return;
    }

    const user = result.rows[0];
    console.log(`✅ Usuário encontrado: ${user.name}`);
    console.log(`   Role: ${user.role || 'não definido'}`);
    
    // Testar senha
    const validPassword = await bcrypt.compare(password, user.password);
    
    if (validPassword) {
      console.log('✅ Senha está correta!');
    } else {
      console.log('❌ Senha está incorreta!');
      console.log('   Vamos resetar a senha...');
      
      const hashedPassword = await bcrypt.hash(password, 10);
      await pool.query(
        `UPDATE "User" SET password = $1, "updatedAt" = NOW() WHERE email = $2`,
        [hashedPassword, email]
      );
      console.log('✅ Senha resetada!');
    }
  } catch (error) {
    console.error('❌ Erro:', error.message);
  } finally {
    await pool.end();
  }
}

testLogin();
