# Criar Usuário Administrador

## 📋 Como Criar o Usuário Admin

Execute o script Node.js que cria o usuário administrador:

```bash
npm run create:admin
```

Ou diretamente:

```bash
node scripts/create-admin-user.js
```

## 👤 Dados do Usuário Admin

- **Email**: jeffersonlima@ideiaum.com.br
- **Senha**: @123Mudar
- **Nome**: Jefferson Lima
- **Role**: ADMIN

## ⚠️ Pré-requisitos

1. Certifique-se de que o script `add-user-role.sql` já foi executado
2. Configure a variável de ambiente `DATABASE_URL` no arquivo `.env`
3. O banco de dados deve estar acessível

## 🔄 Se o Usuário Já Existe

Se o usuário com esse email já existir, o script irá:
- Atualizar o role para `ADMIN` automaticamente
- Manter os outros dados do usuário inalterados

## 🛡️ Segurança

⚠️ **IMPORTANTE**: Após criar o usuário, considere:
- Alterar a senha padrão se necessário
- Não compartilhar as credenciais
- Usar autenticação de dois fatores em produção (futuro)
