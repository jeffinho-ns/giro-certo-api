-- Adicionar tipos de alerta de broadcast (notificação para rede/comunidade)
-- Execute uma vez: psql $DATABASE_URL -f scripts/migrate-broadcast-alerts.sql

ALTER TYPE "AlertType" ADD VALUE 'BROADCAST_NEED_HELP';
ALTER TYPE "AlertType" ADD VALUE 'BROADCAST_BIKE_STOPPED';
ALTER TYPE "AlertType" ADD VALUE 'BROADCAST_ACCIDENT';
ALTER TYPE "AlertType" ADD VALUE 'BROADCAST_BLITZ';
