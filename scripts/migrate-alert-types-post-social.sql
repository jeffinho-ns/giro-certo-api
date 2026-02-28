-- Tipos de alerta para atividade em posts (like, comentário)
DO $$ BEGIN ALTER TYPE "AlertType" ADD VALUE 'POST_LIKE'; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TYPE "AlertType" ADD VALUE 'POST_COMMENT'; EXCEPTION WHEN duplicate_object THEN null; END $$;
