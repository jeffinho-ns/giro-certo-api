# Como Configurar DATABASE_URL no Render

## ⚠️ Problema Atual
A API está tentando conectar em `localhost:5432`, o que significa que `DATABASE_URL` não está configurada no Render.

## 📍 Passo a Passo para Configurar

### 1. Acesse o Painel do Render
1. Vá para [dashboard.render.com](https://dashboard.render.com)
2. Faça login na sua conta

### 2. Encontre o Serviço da API
1. Na lista de serviços, encontre e clique em **`giro-certo-api`**

### 3. Acesse as Variáveis de Ambiente
1. No menu lateral esquerdo, clique em **"Environment"** (ou "Variáveis de Ambiente")
2. Ou procure pela aba/seção **"Environment Variables"** ou **"Env"**

### 4. Adicione/Verifique a Variável DATABASE_URL
1. Procure por uma variável chamada **`DATABASE_URL`** na lista
2. Se não existir, clique em **"Add Environment Variable"**
3. Preencha:
   - **Key**: `DATABASE_URL`
   - **Value**: `postgresql://ciro_certo_db_user:Ocmeex5f2qUViao967jipLoAzsEDVzM5@dpg-d5oq5dpr0fns73afoq50-a.oregon-postgres.render.com/ciro_certo_db`

### 5. Outras Variáveis Necessárias
Certifique-se de que estas variáveis também estão configuradas:

1. **JWT_SECRET**
   - Key: `JWT_SECRET`
   - Value: (gere uma chave secreta forte, ex: `sua-chave-super-secreta-aqui-123456`)

2. **NODE_ENV**
   - Key: `NODE_ENV`
   - Value: `production`

3. **CORS_ORIGIN** (após saber o domínio do Vercel)
   - Key: `CORS_ORIGIN`
   - Value: `https://seu-dominio.vercel.app`

### 6. Salvar e Reiniciar
1. Clique em **"Save Changes"** ou **"Save"**
2. O Render irá reiniciar automaticamente o serviço

## 🔍 Verificar se Está Funcionando

Após configurar, verifique os logs do Render. Você deve ver:
```
🚀 Giro Certo API rodando na porta XXXX
```

E não deve mais aparecer erros de `ECONNREFUSED`.

## 📝 URL Completa do Banco

```
postgresql://ciro_certo_db_user:Ocmeex5f2qUViao967jipLoAzsEDVzM5@dpg-d5oq5dpr0fns73afoq50-a.oregon-postgres.render.com/ciro_certo_db
```

**IMPORTANTE**: Copie e cole exatamente essa URL, sem espaços ou quebras de linha.
