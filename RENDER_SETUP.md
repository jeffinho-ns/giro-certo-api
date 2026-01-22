# Configuração do Render

## Build & Start Commands

No painel do Render, configure:

**Build Command:**
```bash
npm install && npm run build
```

**Start Command:**
```bash
npm start
```

## Variáveis de Ambiente

Configure as seguintes variáveis de ambiente no Render:

1. **DATABASE_URL** - URL de conexão do PostgreSQL
   - Formato: `postgresql://user:password@host:port/database?schema=public`

2. **JWT_SECRET** - Chave secreta para JWT (use uma string aleatória forte)
   - Exemplo: `sua-chave-secreta-super-segura-aqui`

3. **CORS_ORIGIN** - URL do front-end (Vercel)
   - Exemplo: `https://giro-certo-next.vercel.app`
   - Para desenvolvimento: `http://localhost:3000`

4. **NODE_ENV** - Ambiente
   - Valor: `production`

5. **PORT** - Porta (opcional, Render define automaticamente)

## Migrações do Banco de Dados

Após configurar o DATABASE_URL, execute as migrações:

1. Acesse o Shell do serviço no Render
2. Execute:
```bash
npx prisma migrate deploy
```

Ou adicione ao build command:
```bash
npm install && npm run build && npx prisma migrate deploy
```

## Verificação

Após o deploy, teste o endpoint de health:
```
https://giro-certo-api.onrender.com/health
```

Deve retornar:
```json
{
  "status": "ok",
  "message": "Giro Certo API is running"
}
```
