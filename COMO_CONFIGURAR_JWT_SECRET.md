# Como Configurar JWT_SECRET no Render

## 🔑 Gerar JWT_SECRET

Uma chave secreta JWT segura foi gerada para você. Use uma das opções abaixo:

### Opção 1: Chave Gerada (Recomendada)
```
a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2g3h4i5j6k7l8m9n0o1p2q3r4s5t6u7v8w9x0y1z2
```

### Opção 2: Gerar Nova Chave
Se preferir gerar uma nova, execute no terminal:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

## 📍 Como Configurar no Render

### 1. Acesse o Painel do Render
1. Vá para [dashboard.render.com](https://dashboard.render.com)
2. Faça login na sua conta

### 2. Encontre o Serviço
1. Na lista de serviços, clique em **`giro-certo-api`**

### 3. Acesse Environment Variables
1. No menu lateral, clique em **"Environment"** ou **"Env"**
2. Ou procure por **"Environment Variables"**

### 4. Adicione JWT_SECRET
1. Clique em **"Add Environment Variable"** ou **"Add Variable"**
2. Preencha:
   - **Key**: `JWT_SECRET`
   - **Value**: Cole a chave gerada acima (ou gere uma nova)

### 5. Salvar
1. Clique em **"Save Changes"**
2. O Render reiniciará o serviço automaticamente

## ⚠️ Importante

- **NÃO compartilhe** essa chave publicamente
- Use a mesma chave em produção e desenvolvimento (ou diferentes, mas mantenha consistência)
- Se perder a chave, todos os tokens existentes serão invalidados

## 🔄 Se Precisar Trocar a Chave

Se precisar trocar a JWT_SECRET:
1. Gere uma nova chave
2. Atualize no Render
3. Todos os usuários precisarão fazer login novamente
