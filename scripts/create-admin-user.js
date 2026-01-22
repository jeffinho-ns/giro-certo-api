const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
require('dotenv').config();

// URL do banco de dados do Render (conforme SETUP.md)
const DATABASE_URL = process.env.DATABASE_URL || 
  'postgresql://ciro_certo_db_user:Ocmeex5f2qUViao967jipLoAzsEDVzM5@dpg-d5oq5dpr0fns73afoq50-a.oregon-postgres.render.com/ciro_certo_db';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: connectionString.includes('render.com') ? { rejectUnauthorized: false } : false,
});

async function createAdminUser() {
  const email = 'jeffersonlima@ideiaum.com.br';
  const password = '@123Mudar';
  const name = 'Jefferson Lima';
  const age = 30;

  try {
    // Verificar se o usuário já existe
    const existingUser = await pool.query(
      'SELECT id FROM "User" WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      console.log('Usuário já existe. Atualizando role para ADMIN...');
      await pool.query(
        `UPDATE "User" SET role = 'ADMIN', "updatedAt" = NOW() WHERE email = $1`,
        [email]
      );
      console.log('✅ Role atualizado para ADMIN com sucesso!');
      return;
    }

    // Gerar hash da senha
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Gerar IDs (formato similar ao generateId usado no projeto)
    const generateId = () => {
      const timestamp = Date.now().toString(36);
      const randomPart = Math.random().toString(36).substring(2, 15);
      return `${timestamp}${randomPart}`;
    };
    
    const userId = generateId();
    const walletId = generateId();

    // Criar usuário e wallet em uma transação
    await pool.query('BEGIN');

    try {
      // Criar usuário
      await pool.query(
        `INSERT INTO "User" (
          id, name, email, password, age, "photoUrl", "pilotProfile", role,
          "isSubscriber", "subscriptionType", "loyaltyPoints",
          "currentLat", "currentLng", "isOnline", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())`,
        [
          userId,
          name,
          email,
          hashedPassword,
          age,
          null,
          'URBANO',
          'ADMIN',
          false,
          'standard',
          0,
          null,
          null,
          false,
        ]
      );

      // Criar wallet
      await pool.query(
        `INSERT INTO "Wallet" (id, "userId", balance, "totalEarned", "totalWithdrawn", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [walletId, userId, 0, 0, 0]
      );

      await pool.query('COMMIT');
      console.log('✅ Usuário administrador criado com sucesso!');
      console.log(`📧 Email: ${email}`);
      console.log(`🔑 Senha: ${password}`);
      console.log(`👤 Role: ADMIN`);
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('❌ Erro ao criar usuário:', error.message);
    console.error('Detalhes:', error);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

createAdminUser();
