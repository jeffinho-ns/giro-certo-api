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
    console.log('🔄 Executando migração FollowRequest + Alert (FOLLOW_REQUEST + metadata)...\n');

    await client.query(`
      CREATE TABLE IF NOT EXISTS "FollowRequest" (
        id TEXT PRIMARY KEY,
        "requesterId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
        "targetId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
        "createdAt" TIMESTAMP DEFAULT NOW(),
        "respondedAt" TIMESTAMP,
        UNIQUE("requesterId", "targetId")
      );
      CREATE INDEX IF NOT EXISTS "FollowRequest_requesterId_idx" ON "FollowRequest"("requesterId");
      CREATE INDEX IF NOT EXISTS "FollowRequest_targetId_idx" ON "FollowRequest"("targetId");
      CREATE INDEX IF NOT EXISTS "FollowRequest_status_idx" ON "FollowRequest"(status);
    `);
    console.log('✅ Tabela FollowRequest');

    try {
      await client.query(`DO $$ BEGIN ALTER TYPE "AlertType" ADD VALUE 'FOLLOW_REQUEST'; EXCEPTION WHEN duplicate_object THEN null; END $$`);
      console.log('✅ Enum FOLLOW_REQUEST');
    } catch (e) {
      console.log('⚠️  Enum:', e.message);
    }

    await client.query(`ALTER TABLE "Alert" ADD COLUMN IF NOT EXISTS metadata JSONB`);
    console.log('✅ Coluna Alert.metadata');

    await client.query(`COMMENT ON TABLE "FollowRequest" IS 'Pedidos de seguimento entre utilizadores (rede social)'`);
    await client.query(`COMMENT ON COLUMN "Alert".metadata IS 'Dados extras (ex: followRequestId para tipo FOLLOW_REQUEST)'`);
    console.log('✅ Migração follow-requests concluída.\n');
  } catch (error) {
    if (error.message.includes('already exists') || error.message.includes('duplicate')) {
      console.log('⚠️  Objetos já existem. Migração já foi aplicada.\n');
    } else {
      console.error('❌ Erro:', error.message);
      process.exit(1);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
