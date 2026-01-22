# Como Configurar CORS_ORIGIN no Render

## 📍 Passo a Passo

### 1. Acesse o Painel do Render
1. Vá para [dashboard.render.com](https://dashboard.render.com)
2. Faça login na sua conta

### 2. Encontre o Serviço da API
1. Na lista de serviços, encontre e clique em **`giro-certo-api`**
2. Você será redirecionado para a página de detalhes do serviço

### 3. Acesse as Variáveis de Ambiente
1. No menu lateral esquerdo, clique em **"Environment"** (ou "Variáveis de Ambiente")
2. Ou procure pela aba/seção **"Environment Variables"** ou **"Env"**

### 4. Adicione/Edite a Variável CORS_ORIGIN
1. Procure por uma variável chamada **`CORS_ORIGIN`** na lista
2. Se não existir, clique no botão **"Add Environment Variable"** ou **"Add Variable"**
3. Preencha:
   - **Key**: `CORS_ORIGIN`
   - **Value**: `https://seu-dominio.vercel.app` (substitua pelo domínio real do seu frontend)
   
   **Exemplo:**
   ```
   Key: CORS_ORIGIN
   Value: https://giro-certo-next.vercel.app
   ```

### 5. Para Permitir Múltiplos Domínios
Se quiser permitir tanto produção quanto desenvolvimento:
```
https://giro-certo-next.vercel.app,http://localhost:3000
```

### 6. Salvar e Reiniciar
1. Clique em **"Save Changes"** ou **"Save"**
2. O Render irá reiniciar automaticamente o serviço com as novas variáveis

## 🔍 Onde Fica no Render?

A seção de variáveis de ambiente geralmente está em:
- **Menu lateral**: "Environment" ou "Env"
- **Ou na página do serviço**: Procure por uma aba/seção chamada "Environment Variables"
- **Ou no topo**: Pode haver um botão "Environment" ou "Env" na barra de navegação

## ⚠️ Importante

- Após adicionar/editar a variável, o Render reinicia o serviço automaticamente
- Aguarde alguns minutos para o serviço reiniciar
- Verifique os logs para confirmar que o serviço iniciou corretamente

## 🧪 Testar se Funcionou

Após configurar, teste fazendo uma requisição do frontend:
```javascript
fetch('https://giro-certo-api.onrender.com/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: '...', password: '...' })
})
```

Se não houver erro de CORS, está funcionando!
