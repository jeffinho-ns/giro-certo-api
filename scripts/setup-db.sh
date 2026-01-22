#!/bin/bash

# Script para configurar o banco de dados
# Execute: bash scripts/setup-db.sh

echo "🚀 Configurando banco de dados..."

# Dados de conexão
DB_HOST="dpg-d5oq5dpr0fns73afoq50-a.oregon-postgres.render.com"
DB_PORT="5432"
DB_NAME="ciro_certo_db"
DB_USER="ciro_certo_db_user"
DB_PASSWORD="Ocmeex5f2qUViao967jipLoAzsEDVzM5"

# URL de conexão
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

echo "📦 Executando migração SQL..."

# Executar script SQL
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f scripts/migrate.sql

if [ $? -eq 0 ]; then
    echo "✅ Banco de dados configurado com sucesso!"
    echo ""
    echo "📝 Variáveis de ambiente:"
    echo "DATABASE_URL=$DATABASE_URL"
else
    echo "❌ Erro ao configurar banco de dados"
    exit 1
fi
