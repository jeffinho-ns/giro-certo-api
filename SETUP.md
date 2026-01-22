# Setup do Projeto Giro Certo API

## 🗄️ Banco de Dados

O banco de dados PostgreSQL já está configurado no Render:

- **Hostname**: `dpg-d5oq5dpr0fns73afoq50-a.oregon-postgres.render.com`
- **Port**: `5432`
- **Database**: `ciro_certo_db`
- **Username**: `ciro_certo_db_user`
- **Password**: `Ocmeex5f2qUViao967jipLoAzsEDVzM5`

### URL de Conexão

```
postgresql://ciro_certo_db_user:Ocmeex5f2qUViao967jipLoAzsEDVzM5@dpg-d5oq5dpr0fns73afoq50-a.oregon-postgres.render.com/ciro_certo_db
```

## 📋 Passos para Configuração

### 1. Instalar Dependências

```bash
yarn install
```

### 2. Configurar Variáveis de Ambiente

Copie o arquivo `.env.example` para `.env` (já está criado com as configurações):

```bash
cp .env.example .env
```

O arquivo `.env` já contém:
- `DATABASE_URL` - URL de conexão com o banco
- `JWT_SECRET` - Chave secreta para JWT (altere em produção)
- `PORT` - Porta do servidor (3001)
- `CORS_ORIGIN` - Origem permitida para CORS

### 3. Executar Migração do Banco de Dados

Execute o script para criar todas as tabelas:

```bash
yarn db:setup
```

Ou usando Node.js diretamente:

```bash
node scripts/setup-db.js
```

Ou usando psql:

```bash
PGPASSWORD=Ocmeex5f2qUViao967jipLoAzsEDVzM5 psql -h dpg-d5oq5dpr0fns73afoq50-a.oregon-postgres.render.com -U ciro_certo_db_user ciro_certo_db -f scripts/migrate.sql
```

### 4. Executar em Desenvolvimento

```bash
yarn dev
```

A API estará disponível em `http://localhost:3001`

### 5. Build para Produção

```bash
yarn build
yarn start
```

## 🔧 Configuração no Render

No painel do Render, configure as seguintes variáveis de ambiente:

- `DATABASE_URL`: `postgresql://ciro_certo_db_user:Ocmeex5f2qUViao967jipLoAzsEDVzM5@dpg-d5oq5dpr0fns73afoq50-a.oregon-postgres.render.com/ciro_certo_db`
- `JWT_SECRET`: (gere uma chave secreta forte)
- `NODE_ENV`: `production`
- `CORS_ORIGIN`: (URL do seu front-end)

## 📝 Estrutura do Banco

O script `scripts/migrate.sql` cria:

- **Enums**: SubscriptionType, PilotProfile, MaintenanceCategory, etc.
- **Tabelas**: User, Bike, MaintenanceLog, Partner, DeliveryOrder, Wallet, Post, etc.
- **Índices**: Para otimização de queries
- **Relacionamentos**: Foreign keys e constraints

## ✅ Verificação

Após executar a migração, você pode verificar as tabelas:

```bash
PGPASSWORD=Ocmeex5f2qUViao967jipLoAzsEDVzM5 psql -h dpg-d5oq5dpr0fns73afoq50-a.oregon-postgres.render.com -U ciro_certo_db_user ciro_certo_db -c "\dt"
```

## 🚀 Endpoints

Após iniciar o servidor, teste o endpoint de health:

```bash
curl http://localhost:3001/health
```

Deve retornar:
```json
{
  "status": "ok",
  "message": "Giro Certo API is running"
}
```
