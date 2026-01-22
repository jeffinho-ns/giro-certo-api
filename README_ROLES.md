# Sistema de Roles e Permissões - Giro Certo API

## 📋 Visão Geral

O sistema agora possui três níveis de permissão:
- **USER**: Usuário comum do sistema (padrão)
- **MODERATOR**: Moderador com acesso a funcionalidades administrativas limitadas
- **ADMIN**: Administrador com acesso total ao sistema

## 🗄️ Migração do Banco de Dados

Execute o script SQL para adicionar o campo `role` à tabela `User`:

```bash
# Conecte-se ao banco de dados e execute:
psql -h dpg-d5oq5dpr0fns73afoq50-a.oregon-postgres.render.com -U ciro_certo_db_user -d ciro_certo_db -f scripts/add-user-role.sql
```

Ou execute diretamente no Render:
1. Acesse o Shell do serviço de banco de dados no Render
2. Execute o conteúdo do arquivo `scripts/add-user-role.sql`

## 🔐 Middleware de Autorização

### `authenticateToken`
Verifica se o usuário está autenticado e adiciona informações do usuário à requisição.

### `requireAdmin`
Garante que apenas administradores possam acessar a rota.

### `requireModerator`
Garante que moderadores e administradores possam acessar a rota.

## 📝 Exemplos de Uso

### Proteger rota apenas para admin:
```typescript
import { authenticateToken, requireAdmin } from '../middleware/auth';

router.get('/admin-only', authenticateToken, requireAdmin, async (req, res) => {
  // Apenas admins podem acessar
});
```

### Proteger rota para moderadores e admins:
```typescript
import { authenticateToken, requireModerator } from '../middleware/auth';

router.get('/moderator-access', authenticateToken, requireModerator, async (req, res) => {
  // Moderadores e admins podem acessar
});
```

## 🔄 Atualizar Role de Usuário

### Endpoint: `PUT /api/users/:userId/role`

**Apenas administradores podem atualizar roles.**

**Body:**
```json
{
  "role": "MODERATOR" // ou "ADMIN" ou "USER"
}
```

**Exemplo:**
```bash
curl -X PUT https://giro-certo-api.onrender.com/api/users/USER_ID/role \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role": "MODERATOR"}'
```

## ⚠️ Importante

- Um administrador não pode remover seu próprio acesso de administrador
- Todos os novos usuários são criados com role `USER` por padrão
- O role é incluído no token JWT após o login
- O middleware `authenticateToken` busca o role do banco de dados para garantir que está atualizado
