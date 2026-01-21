# 🏍️ Giro Certo API

Back-end da plataforma Giro Certo - Ecossistema completo para motociclistas.

## 🚀 Tecnologias

- **Node.js** com **TypeScript**
- **Express** - Framework web
- **Prisma ORM** - ORM para PostgreSQL
- **Socket.io** - WebSockets para rastreamento em tempo real
- **PostgreSQL** - Banco de dados

## 📋 Pré-requisitos

- Node.js 18+
- PostgreSQL 14+
- npm ou yarn

## 🔧 Instalação

1. Instale as dependências:
```bash
npm install
```

2. Configure as variáveis de ambiente:
```bash
cp .env.example .env
# Edite o arquivo .env com suas configurações
```

3. Configure o banco de dados:
```bash
# Gere o Prisma Client
npm run prisma:generate

# Execute as migrações
npm run prisma:migrate
```

4. Inicie o servidor em desenvolvimento:
```bash
npm run dev
```

## 📁 Estrutura do Projeto

```
giro-certo-api/
├── src/
│   ├── controllers/    # Controllers das rotas
│   ├── services/       # Lógica de negócio
│   ├── routes/         # Definição de rotas
│   ├── middleware/     # Middlewares customizados
│   ├── utils/          # Utilitários
│   └── types/          # Tipos TypeScript
├── prisma/
│   └── schema.prisma   # Schema do banco de dados
└── dist/               # Build compilado
```

## 🔑 Funcionalidades Principais

- ✅ Sistema de Assinaturas (Standard/Premium)
- ✅ Matching Algorithm para entregas
- ✅ Rastreamento em Tempo Real via WebSocket
- ✅ Sistema de Fidelidade (Pontos de fidelidade)
- ✅ Gestão de Comissões (R$ 1,00 padrão / R$ 3,00 premium)
- ✅ Mapa de Calor de Pedidos
- ✅ Gestão de Manutenção de Motos
- ✅ Sistema de Wallets

## 📝 Scripts Disponíveis

- `npm run dev` - Inicia o servidor em modo desenvolvimento
- `npm run build` - Compila o TypeScript
- `npm run start` - Inicia o servidor em produção
- `npm run prisma:generate` - Gera o Prisma Client
- `npm run prisma:migrate` - Executa migrações do banco
- `npm run prisma:studio` - Abre o Prisma Studio

## 🔒 Variáveis de Ambiente

```env
DATABASE_URL="postgresql://user:password@localhost:5432/giro_certo"
JWT_SECRET="your-secret-key"
PORT=3001
CORS_ORIGIN="http://localhost:3000"
```

## 📡 WebSocket Events

- `rider:location` - Recebe localização do motociclista
- `rider:location:update` - Broadcast de atualização de localização
- `delivery:update` - Atualização de status de pedido

## 📚 Documentação da API

Em desenvolvimento...
