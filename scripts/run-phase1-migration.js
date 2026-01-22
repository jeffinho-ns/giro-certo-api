const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ Erro: DATABASE_URL não está configurada no .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: connectionString.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Iniciando migration FASE 1...\n');
    
    // Ler o arquivo SQL
    const migrationPath = path.join(__dirname, 'migrate-phase1-vehicle-documents.sql');
    let sql = fs.readFileSync(migrationPath, 'utf8');
    
    // Remover comentários de linha única (-- comentário)
    sql = sql.replace(/--.*$/gm, '');
    
    // Dividir em blocos lógicos (separados por ; seguido de quebra de linha)
    // Isso preserva comandos multi-linha como ALTER TABLE
    const commands = sql
      .split(/;\s*\n/)
      .map(cmd => cmd.trim())
      .filter(cmd => {
        // Remover linhas vazias e comentários
        const lines = cmd.split('\n').filter(line => {
          const trimmed = line.trim();
          return trimmed.length > 0 && !trimmed.startsWith('--');
        });
        return lines.length > 0;
      });
    
    console.log(`📝 Executando ${commands.length} comandos SQL...\n`);
    
    // Executar cada comando
    for (let i = 0; i < commands.length; i++) {
      let command = commands[i].trim();
      
      if (command.length === 0) continue;
      
      // Adicionar ; se não tiver
      if (!command.endsWith(';')) {
        command += ';';
      }
      
      try {
        await client.query(command);
        
        // Extrair nome do comando para log
        const firstLine = command.split('\n')[0].trim();
        const commandName = firstLine.length > 60 
          ? firstLine.substring(0, 60) + '...' 
          : firstLine;
        console.log(`✅ [${i + 1}/${commands.length}] ${commandName}`);
      } catch (error) {
        // Se for erro de "já existe", continuar (IF NOT EXISTS)
        if (
          error.message.includes('already exists') ||
          error.message.includes('duplicate key') ||
          (error.message.includes('does not exist') && command.includes('IF NOT EXISTS')) ||
          error.message.includes('column') && error.message.includes('already exists')
        ) {
          const firstLine = command.split('\n')[0].trim();
          const commandName = firstLine.length > 60 
            ? firstLine.substring(0, 60) + '...' 
            : firstLine;
          console.log(`⚠️  [${i + 1}/${commands.length}] Já existe: ${commandName}`);
          continue;
        }
        
        console.error(`\n❌ Erro no comando ${i + 1}:`);
        console.error(`   ${command.substring(0, 150)}...`);
        console.error(`   Erro: ${error.message}\n`);
        throw error;
      }
    }
    
    console.log('\n✅ Migration FASE 1 executada com sucesso!\n');
    
    // Verificar o que foi criado
    console.log('🔍 Verificando resultados...\n');
    
    // Verificar enums
    const enumCheck = await client.query(`
      SELECT typname FROM pg_type 
      WHERE typname IN ('VehicleType', 'DocumentType', 'DocumentStatus')
      ORDER BY typname
    `);
    console.log(`📊 Enums criados: ${enumCheck.rows.length}/3`);
    enumCheck.rows.forEach(row => {
      console.log(`   ✓ ${row.typname}`);
    });
    
    // Verificar tabelas
    const tableCheck = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('CourierDocument', 'VerificationSelfie')
      ORDER BY table_name
    `);
    console.log(`\n📊 Tabelas criadas: ${tableCheck.rows.length}/2`);
    tableCheck.rows.forEach(row => {
      console.log(`   ✓ ${row.table_name}`);
    });
    
    // Verificar colunas adicionadas em User
    const userColumnsCheck = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'User' 
      AND column_name IN ('hasVerifiedDocuments', 'verificationBadge', 'maintenanceBlockOverride')
      ORDER BY column_name
    `);
    console.log(`\n📊 Colunas adicionadas em User: ${userColumnsCheck.rows.length}/3`);
    userColumnsCheck.rows.forEach(row => {
      console.log(`   ✓ ${row.column_name}`);
    });
    
    // Verificar colunas adicionadas em Bike
    const bikeColumnsCheck = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'Bike' 
      AND column_name IN ('vehicleType', 'vehiclePhotoUrl', 'platePhotoUrl')
      ORDER BY column_name
    `);
    console.log(`\n📊 Colunas adicionadas em Bike: ${bikeColumnsCheck.rows.length}/3`);
    bikeColumnsCheck.rows.forEach(row => {
      console.log(`   ✓ ${row.column_name}`);
    });
    
    console.log('\n🎉 Migration completa e verificada!\n');
    
  } catch (error) {
    console.error('\n❌ Erro durante a migration:');
    console.error(error.message);
    console.error('\n💡 Dica: Verifique se o banco de dados está acessível e se todas as tabelas base existem.');
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
