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
  ssl: DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Iniciando migration FASE 6...\n');
    
    // Ler o arquivo SQL
    const migrationPath = path.join(__dirname, 'migrate-phase6-disputes.sql');
    let sql = fs.readFileSync(migrationPath, 'utf8');
    
    // Remover comentários de linha única (-- comentário)
    sql = sql.replace(/--.*$/gm, '');
    
    // Dividir comandos SQL de forma mais inteligente
    // Tratar blocos DO $$ ... END $$ como comandos únicos
    const commands = [];
    let currentCommand = '';
    let inDoBlock = false;
    let dollarTag = '';
    
    const lines = sql.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.length === 0) continue;
      
      // Detectar início de bloco DO $$
      if (line.match(/^DO\s+\$\$/)) {
        inDoBlock = true;
        dollarTag = '$$';
        currentCommand = line + '\n';
        continue;
      }
      
      // Se estiver em um bloco DO, adicionar linha até encontrar END $$
      if (inDoBlock) {
        currentCommand += line + '\n';
        
        // Verificar se encontrou o fim do bloco
        if (line.match(/END\s+\$\$\s*;?$/)) {
          commands.push(currentCommand.trim());
          currentCommand = '';
          inDoBlock = false;
          dollarTag = '';
        }
        continue;
      }
      
      // Comandos normais
      currentCommand += line + '\n';
      
      // Se a linha termina com ; e não está em um bloco, é um comando completo
      if (line.endsWith(';')) {
        commands.push(currentCommand.trim());
        currentCommand = '';
      }
    }
    
    // Adicionar último comando se houver
    if (currentCommand.trim().length > 0) {
      commands.push(currentCommand.trim());
    }
    
    // Filtrar comandos vazios
    const filteredCommands = commands
      .map(cmd => cmd.trim())
      .filter(cmd => {
        const lines = cmd.split('\n').filter(line => {
          const trimmed = line.trim();
          return trimmed.length > 0 && !trimmed.startsWith('--');
        });
        return lines.length > 0;
      });
    
    console.log(`📝 Executando ${filteredCommands.length} comandos SQL...\n`);
    
    // Executar cada comando
    for (let i = 0; i < filteredCommands.length; i++) {
      let command = filteredCommands[i].trim();
      
      if (command.length === 0) continue;
      
      // Adicionar ; se não tiver
      if (!command.endsWith(';')) {
        command += ';';
      }
      
      try {
        await client.query(command);
        
        const firstLine = command.split('\n')[0].trim();
        const commandName = firstLine.length > 60 
          ? firstLine.substring(0, 60) + '...' 
          : firstLine;
        console.log(`✅ [${i + 1}/${filteredCommands.length}] ${commandName}`);
      } catch (error) {
        // Se for erro de "já existe", continuar (IF NOT EXISTS)
        if (
          error.message.includes('already exists') ||
          error.message.includes('duplicate key') ||
          (error.message.includes('does not exist') && command.includes('IF NOT EXISTS')) ||
          (error.message.includes('column') && error.message.includes('already exists'))
        ) {
          const firstLine = command.split('\n')[0].trim();
          const commandName = firstLine.length > 60 
            ? firstLine.substring(0, 60) + '...' 
            : firstLine;
          console.log(`⚠️  [${i + 1}/${filteredCommands.length}] Já existe: ${commandName}`);
          continue;
        }
        
        console.error(`\n❌ Erro no comando ${i + 1}:`);
        console.error(`   ${command.substring(0, 150)}...`);
        console.error(`   Erro: ${error.message}\n`);
        throw error;
      }
    }
    
    console.log('\n✅ Migration FASE 6 executada com sucesso!\n');
    
    // Verificar o que foi criado
    console.log('🔍 Verificando resultados...\n');
    
    // Verificar enums
    const enumCheck = await client.query(`
      SELECT typname FROM pg_type 
      WHERE typname IN ('DisputeStatus', 'DisputeType')
      ORDER BY typname
    `);
    console.log(`📊 Enums criados: ${enumCheck.rows.length}/2`);
    enumCheck.rows.forEach(row => {
      console.log(`   ✓ ${row.typname}`);
    });
    
    // Verificar tabela
    const tableCheck = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'Dispute'
    `);
    console.log(`\n📊 Tabela criada: ${tableCheck.rows.length > 0 ? 'Sim' : 'Não'}`);
    if (tableCheck.rows.length > 0) {
      console.log(`   ✓ Dispute`);
    }
    
    // Verificar índices
    const indexCheck = await client.query(`
      SELECT indexname FROM pg_indexes 
      WHERE tablename = 'Dispute'
      ORDER BY indexname
    `);
    console.log(`\n📊 Índices criados: ${indexCheck.rows.length}`);
    indexCheck.rows.forEach(row => {
      console.log(`   ✓ ${row.indexname}`);
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
