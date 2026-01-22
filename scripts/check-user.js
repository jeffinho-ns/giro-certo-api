const { Pool } = require('pg');
require('dotenv').config();

// URL do banco de dados do Render
const DATABASE_URL = process.env.DATABASE_URL || 
  'postgresql://ciro_certo_db_user:Ocmeex5f2qUViao967jipLoAzsEDVzM5@dpg-d5oq5dpr0fns73afoq50-a.oregon-postgres.render.com/ciro_certo_db';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: connectionString.includes('render.com') ? { rejectUnauthorized: false } : false,
});

async function checkUser() {
  const email = 'jeffersonlima@ideiaum.com.br';

  try {
    const result = await pool.query(
      'SELECT id, name, email, role FROM "User" WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      console.log('❌ Usuário não encontrado no banco de dados');
      console.log('📝 Execute: npm run create:admin para criar o usuário');
    } else {
      const user = result.rows[0];
      console.log('✅ Usuário encontrado:');
      console.log(`   ID: ${user.id}`);
      console.log(`   Nome: ${user.name}`);
      console.log(`   Email: ${user.email}`);
      console.log(`   Role: ${user.role}`);
    }
  } catch (error) {
    console.error('❌ Erro ao verificar usuário:', error.message);
  } finally {
    await pool.end();
  }
}

checkUser();
