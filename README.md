# Giro Certo API

Back-end API para o ecossistema Giro Certo - Sistema de delivery para motociclistas.

## 🚀 Início Rápido

### 1. Instalar Dependências

```bash
yarn install
```

### 2. Configurar Variáveis de Ambiente

Copie o arquivo `.env.example` para `.env`:

```bash
cp .env.example .env
```

O arquivo `.env` já está configurado com as credenciais do banco de dados.

### 3. Configurar Banco de Dados

Execute a migração para criar todas as tabelas:

```bash
yarn db:setup
```

Ou:

```bash
node scripts/setup-db.js
```

### 4. Executar em Desenvolvimento

```bash
yarn dev
```

A API estará disponível em `http://localhost:3001`

## 📋 Scripts Disponíveis

- `yarn dev` - Executa em modo desenvolvimento com hot-reload
- `yarn build` - Compila TypeScript para JavaScript
- `yarn start` - Executa a aplicação em produção
- `yarn db:setup` - Executa a migração do banco de dados

## 🗄️ Banco de Dados

O banco de dados PostgreSQL está hospedado no Render:

- **Host**: `dpg-d5oq5dpr0fns73afoq50-a.oregon-postgres.render.com`
- **Database**: `ciro_certo_db`
- **User**: `ciro_certo_db_user`

A URL de conexão está configurada no arquivo `.env`.

## 📚 Documentação

- [SETUP.md](./SETUP.md) - Guia completo de configuração
- [MIGRATION.md](./MIGRATION.md) - Documentação da migração do Prisma

## 🔧 Tecnologias

- **Node.js** + **TypeScript**
- **Express** - Framework web
- **PostgreSQL** - Banco de dados (driver `pg`)
- **Socket.io** - WebSockets para tempo real
- **JWT** - Autenticação
- **bcryptjs** - Hash de senhas

## 📝 Estrutura do Projeto

```
src/
├── controllers/     # Controladores
├── lib/            # Bibliotecas (db, etc)
├── middleware/     # Middlewares (auth, error-handler)
├── routes/         # Rotas da API
├── services/       # Lógica de negócio
├── types/          # Tipos TypeScript
└── utils/          # Utilitários
```

## 🔐 Variáveis de Ambiente

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `DATABASE_URL` | URL de conexão PostgreSQL | - |
| `JWT_SECRET` | Chave secreta para JWT | - |
| `JWT_EXPIRES_IN` | Tempo de expiração do token | `7d` |
| `PORT` | Porta do servidor | `3001` |
| `NODE_ENV` | Ambiente (development/production) | `development` |
| `CORS_ORIGIN` | Origem permitida para CORS | `http://localhost:3000` |

## ✅ Health Check

Teste se a API está funcionando:

```bash
curl http://localhost:3001/health
```

Resposta esperada:
```json
{
  "status": "ok",
  "message": "Giro Certo API is running"
}
```

## 📦 Deploy no Render

1. Configure as variáveis de ambiente no painel do Render
2. O build command é: `yarn install && yarn build`
3. O start command é: `yarn start`

Veja mais detalhes em [SETUP.md](./SETUP.md).
