-- Script para adicionar sistema de roles/permissões aos usuários
-- Execute este script no PostgreSQL

-- Criar enum UserRole
DO $$ BEGIN
    CREATE TYPE "UserRole" AS ENUM ('USER', 'MODERATOR', 'ADMIN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Adicionar coluna role à tabela User (se não existir)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'User' AND column_name = 'role'
    ) THEN
        ALTER TABLE "User" ADD COLUMN "role" "UserRole" DEFAULT 'USER';
        CREATE INDEX "User_role_idx" ON "User"("role");
    END IF;
END $$;

-- Atualizar usuários existentes para ter role USER (se necessário)
UPDATE "User" SET "role" = 'USER' WHERE "role" IS NULL;

-- Tornar a coluna NOT NULL após atualizar valores nulos
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'User' AND column_name = 'role' AND is_nullable = 'YES'
    ) THEN
        ALTER TABLE "User" ALTER COLUMN "role" SET NOT NULL;
    END IF;
END $$;
