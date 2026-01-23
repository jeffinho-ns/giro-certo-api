const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Configurar pool com SSL se necessário
const connectionConfig = {
  connectionString: process.env.DATABASE_URL,
};

if (process.env.DATABASE_URL && (process.env.DATABASE_URL.includes('render.com') || process.env.DATABASE_URL.includes('onrender.com'))) {
  connectionConfig.ssl = {
    rejectUnauthorized: false
  };
}

const pool = new Pool(connectionConfig);

function generateId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

async function createUsersForPartners() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Buscando lojistas sem usuário vinculado...\n');
    
    // Buscar parceiros sem usuário vinculado
    const partners = await client.query(`
      SELECT p.id, p.name, p.email, p.type
      FROM "Partner" p
      LEFT JOIN "User" u ON u."partnerId" = p.id
      WHERE u.id IS NULL
      ORDER BY p."createdAt" DESC
    `);
    
    if (partners.rows.length === 0) {
      console.log('✅ Todos os lojistas já têm usuários vinculados!');
      return;
    }
    
    console.log(`📊 Encontrados ${partners.rows.length} lojista(s) sem usuário:\n`);
    
    const DEFAULT_PASSWORD = '@123mudar';
    
    for (const partner of partners.rows) {
      console.log(`\n🏪 Processando: ${partner.name}`);
      console.log(`   Email: ${partner.email || 'Não informado'}`);
      
      if (!partner.email) {
        console.log(`   ⚠️  Email não informado. Pulando...`);
        continue;
      }
      
      // Verificar se já existe usuário com este email
      const existingUser = await client.query(`
        SELECT id, name, email, "partnerId"
        FROM "User"
        WHERE email = $1
      `, [partner.email]);
      
      if (existingUser.rows.length > 0) {
        const user = existingUser.rows[0];
        console.log(`   ℹ️  Usuário com este email já existe. Vinculando ao parceiro...`);
        
        // Vincular usuário existente ao parceiro
        await client.query(`
          UPDATE "User"
          SET "partnerId" = $1, "updatedAt" = NOW()
          WHERE id = $2
        `, [partner.id, user.id]);
        
        console.log(`   ✅ Usuário vinculado com sucesso!`);
        console.log(`      - ID do usuário: ${user.id}`);
        console.log(`      - Email: ${user.email}`);
        console.log(`      - Senha: ${DEFAULT_PASSWORD} (padrão)`);
      } else {
        // Criar novo usuário
        const userId = generateId();
        const walletId = generateId();
        const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10);
        
        await client.query('BEGIN');
        
        try {
          // Criar usuário
          await client.query(`
            INSERT INTO "User" (
              id, name, email, password, age, "photoUrl", "pilotProfile", role, "partnerId",
              "isSubscriber", "subscriptionType", "loyaltyPoints",
              "currentLat", "currentLng", "isOnline", "createdAt", "updatedAt"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
          `, [
            userId,
            partner.name,
            partner.email,
            hashedPassword,
            25, // Idade padrão
            null,
            'URBANO',
            'USER',
            partner.id, // Vincular ao parceiro
            false,
            'standard',
            0,
            null,
            null,
            false,
          ]);
          
          // Criar wallet
          await client.query(`
            INSERT INTO "Wallet" (id, "userId", balance, "totalEarned", "totalWithdrawn", "createdAt", "updatedAt")
            VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
          `, [walletId, userId, 0, 0, 0]);
          
          await client.query('COMMIT');
          
          console.log(`   ✅ Usuário criado com sucesso!`);
          console.log(`      - ID: ${userId}`);
          console.log(`      - Email: ${partner.email}`);
          console.log(`      - Senha: ${DEFAULT_PASSWORD}`);
          console.log(`      - Vinculado ao parceiro: ${partner.id}`);
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
    }
    
    console.log(`\n\n✅ Processo concluído!`);
    
    // Verificar resultado final
    const finalCheck = await client.query(`
      SELECT COUNT(DISTINCT p.id) as total
      FROM "Partner" p
      INNER JOIN "User" u ON u."partnerId" = p.id
    `);
    
    const totalPartners = await client.query(`SELECT COUNT(*) as total FROM "Partner"`);
    
    console.log(`\n📊 RESUMO FINAL:`);
    console.log(`   - Total de lojistas: ${totalPartners.rows[0].total}`);
    console.log(`   - Lojistas com usuário: ${finalCheck.rows[0].total}`);
    
  } catch (error) {
    console.error('❌ Erro ao processar:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

createUsersForPartners();
