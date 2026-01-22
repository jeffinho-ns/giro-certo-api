const { Pool } = require('pg');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// URL do banco de dados do Render
const DATABASE_URL = process.env.DATABASE_URL || 
  'postgresql://ciro_certo_db_user:Ocmeex5f2qUViao967jipLoAzsEDVzM5@dpg-d5oq5dpr0fns73afoq50-a.oregon-postgres.render.com/ciro_certo_db';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: connectionString.includes('render.com') ? { rejectUnauthorized: false } : false,
});

async function addUserRole() {
  try {
    console.log('🔄 Executando migração para adicionar campo role...');

    // Criar enum UserRole
    await pool.query(`
      DO $$ BEGIN
          CREATE TYPE "UserRole" AS ENUM ('USER', 'MODERATOR', 'ADMIN');
      EXCEPTION
          WHEN duplicate_object THEN null;
      END $$;
    `);
    console.log('✅ Enum UserRole criado/verificado');

    // Adicionar coluna role à tabela User (se não existir)
    await pool.query(`
      DO $$ 
      BEGIN
          IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'User' AND column_name = 'role'
          ) THEN
              ALTER TABLE "User" ADD COLUMN "role" "UserRole" DEFAULT 'USER';
              CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User"("role");
          END IF;
      END $$;
    `);
    console.log('✅ Coluna role adicionada/verificada');

    // Atualizar usuários existentes para ter role USER (se necessário)
    await pool.query(`
      UPDATE "User" SET "role" = 'USER' WHERE "role" IS NULL;
    `);
    console.log('✅ Usuários existentes atualizados');

    // Tornar a coluna NOT NULL após atualizar valores nulos
    await pool.query(`
      DO $$ 
      BEGIN
          IF EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'User' AND column_name = 'role' AND is_nullable = 'YES'
          ) THEN
              ALTER TABLE "User" ALTER COLUMN "role" SET NOT NULL;
          END IF;
      END $$;
    `);
    console.log('✅ Coluna role configurada como NOT NULL');

    console.log('✅ Migração concluída com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao executar migração:', error.message);
    console.error('Detalhes:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

addUserRole();
