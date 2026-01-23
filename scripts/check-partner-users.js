const { Pool } = require('pg');
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

async function checkPartnerUsers() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Verificando lojistas e usuários vinculados...\n');
    
    // Buscar todos os parceiros
    const partners = await client.query(`
      SELECT id, name, email, type, "createdAt"
      FROM "Partner"
      ORDER BY "createdAt" DESC
    `);
    
    console.log(`📊 Total de lojistas cadastrados: ${partners.rows.length}\n`);
    
    if (partners.rows.length === 0) {
      console.log('⚠️  Nenhum lojista encontrado no banco de dados.');
      return;
    }
    
    // Para cada parceiro, verificar se tem usuário vinculado
    for (const partner of partners.rows) {
      console.log(`\n🏪 Lojista: ${partner.name}`);
      console.log(`   ID: ${partner.id}`);
      console.log(`   Email: ${partner.email || 'Não informado'}`);
      console.log(`   Tipo: ${partner.type}`);
      console.log(`   Cadastrado em: ${new Date(partner.createdAt).toLocaleString('pt-BR')}`);
      
      // Verificar se tem usuário vinculado
      const user = await client.query(`
        SELECT id, name, email, role, "partnerId", "createdAt"
        FROM "User"
        WHERE "partnerId" = $1
      `, [partner.id]);
      
      if (user.rows.length > 0) {
        const u = user.rows[0];
        console.log(`   ✅ Usuário vinculado encontrado:`);
        console.log(`      - ID: ${u.id}`);
        console.log(`      - Nome: ${u.name}`);
        console.log(`      - Email: ${u.email}`);
        console.log(`      - Role: ${u.role}`);
        console.log(`      - Criado em: ${new Date(u.createdAt).toLocaleString('pt-BR')}`);
      } else {
        console.log(`   ⚠️  Nenhum usuário vinculado encontrado`);
        
        // Verificar se existe usuário com o mesmo email
        if (partner.email) {
          const userByEmail = await client.query(`
            SELECT id, name, email, role, "partnerId", "createdAt"
            FROM "User"
            WHERE email = $1
          `, [partner.email]);
          
          if (userByEmail.rows.length > 0) {
            const u = userByEmail.rows[0];
            console.log(`   ℹ️  Existe usuário com o mesmo email, mas não está vinculado:`);
            console.log(`      - ID: ${u.id}`);
            console.log(`      - Nome: ${u.name}`);
            console.log(`      - Email: ${u.email}`);
            console.log(`      - partnerId atual: ${u.partnerId || 'NULL'}`);
            console.log(`      - Criado em: ${new Date(u.createdAt).toLocaleString('pt-BR')}`);
            console.log(`   💡 Sugestão: Vincular este usuário ao parceiro`);
          }
        }
      }
    }
    
    // Resumo
    console.log(`\n\n📋 RESUMO:`);
    const partnersWithUsers = await client.query(`
      SELECT COUNT(DISTINCT p.id) as total
      FROM "Partner" p
      INNER JOIN "User" u ON u."partnerId" = p.id
    `);
    
    console.log(`   - Lojistas com usuário vinculado: ${partnersWithUsers.rows[0].total}`);
    console.log(`   - Lojistas sem usuário: ${partners.rows.length - parseInt(partnersWithUsers.rows[0].total)}`);
    
  } catch (error) {
    console.error('❌ Erro ao verificar:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

checkPartnerUsers();
