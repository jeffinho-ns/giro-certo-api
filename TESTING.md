# Guia de Testes - Giro Certo API

## 🔗 URLs do Render

Substitua `YOUR_API_URL` pela URL do seu serviço no Render (ex: `https://giro-certo-api.onrender.com`)

## ✅ 1. Health Check

Teste básico para verificar se a API está funcionando:

```bash
curl https://YOUR_API_URL/health
```

**Resposta esperada:**
```json
{
  "status": "ok",
  "message": "Giro Certo API is running"
}
```

## 👤 2. Teste de Registro de Usuário

```bash
curl -X POST https://YOUR_API_URL/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "João Silva",
    "email": "joao@example.com",
    "password": "senha123",
    "age": 30,
    "pilotProfile": "URBANO"
  }'
```

**Resposta esperada:**
```json
{
  "user": {
    "id": "user_id",
    "name": "João Silva",
    "email": "joao@example.com",
    "age": 30,
    "pilotProfile": "URBANO",
    "isSubscriber": false,
    "subscriptionType": "standard",
    "loyaltyPoints": 0
  },
  "token": "jwt_token_aqui"
}
```

**Guarde o `token` para os próximos testes!**

## 🔐 3. Teste de Login

```bash
curl -X POST https://YOUR_API_URL/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "joao@example.com",
    "password": "senha123"
  }'
```

## 📸 4. Upload de Foto de Perfil

```bash
curl -X POST https://YOUR_API_URL/api/images/upload/user/USER_ID \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  -F "image=@/caminho/para/sua/foto.jpg" \
  -F "isPrimary=true"
```

**Resposta esperada:**
```json
{
  "image": {
    "id": "image_id",
    "entityType": "user",
    "entityId": "user_id",
    "filename": "foto.jpg",
    "mimetype": "image/jpeg",
    "size": 12345,
    "isPrimary": true,
    "url": "/api/images/image_id",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

## 🖼️ 5. Visualizar Imagem

Abra no navegador ou use curl:

```bash
curl https://YOUR_API_URL/api/images/IMAGE_ID
```

Ou abra diretamente no navegador:
```
https://YOUR_API_URL/api/images/IMAGE_ID
```

## 🏍️ 6. Criar Moto

```bash
curl -X POST https://YOUR_API_URL/api/bikes \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "CB 600F",
    "brand": "Honda",
    "plate": "ABC1234",
    "currentKm": 15000,
    "oilType": "10W40",
    "frontTirePressure": 2.5,
    "rearTirePressure": 2.8
  }'
```

## 📤 7. Upload de Foto da Moto

```bash
curl -X POST https://YOUR_API_URL/api/images/upload/bike/BIKE_ID \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  -F "image=@/caminho/para/foto-moto.jpg" \
  -F "isPrimary=true"
```

## 📍 8. Atualizar Localização do Usuário

```bash
curl -X PUT https://YOUR_API_URL/api/users/me/location \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  -H "Content-Type: application/json" \
  -d '{
    "latitude": -23.5505,
    "longitude": -46.6333,
    "isOnline": true
  }'
```

## 🛒 9. Criar Pedido de Delivery

```bash
curl -X POST https://YOUR_API_URL/api/delivery/orders \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  -H "Content-Type: application/json" \
  -d '{
    "storeId": "store_id",
    "storeName": "Loja Exemplo",
    "storeAddress": "Rua Exemplo, 123",
    "storeLatitude": -23.5505,
    "storeLongitude": -46.6333,
    "deliveryAddress": "Rua Destino, 456",
    "deliveryLatitude": -23.5515,
    "deliveryLongitude": -46.6343,
    "value": 50.00,
    "deliveryFee": 5.00,
    "priority": "normal"
  }'
```

## 🔍 10. Buscar Motociclistas Disponíveis

```bash
curl "https://YOUR_API_URL/api/delivery/riders?lat=-23.5505&lng=-46.6333&radius=5" \
  -H "Authorization: Bearer SEU_TOKEN_AQUI"
```

## 📊 11. Dashboard Stats (Premium)

```bash
curl https://YOUR_API_URL/api/dashboard/stats \
  -H "Authorization: Bearer SEU_TOKEN_AQUI"
```

## 💰 12. Ver Wallet

```bash
curl https://YOUR_API_URL/api/wallet/me \
  -H "Authorization: Bearer SEU_TOKEN_AQUI"
```

## 📝 13. Criar Post

```bash
curl -X POST https://YOUR_API_URL/api/posts \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Minha primeira postagem na comunidade!",
    "images": []
  }'
```

## 📸 14. Upload de Imagem para Post

```bash
curl -X POST https://YOUR_API_URL/api/images/upload/post/POST_ID \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  -F "image=@/caminho/para/imagem.jpg" \
  -F "isPrimary=false"
```

## 🧪 Script de Teste Completo

Crie um arquivo `test-api.sh`:

```bash
#!/bin/bash

API_URL="https://YOUR_API_URL"

echo "1. Health Check..."
curl -s $API_URL/health | jq

echo -e "\n2. Registrando usuário..."
REGISTER_RESPONSE=$(curl -s -X POST $API_URL/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "password": "test123",
    "age": 25,
    "pilotProfile": "URBANO"
  }')

echo $REGISTER_RESPONSE | jq

# Extrair token
TOKEN=$(echo $REGISTER_RESPONSE | jq -r '.token')
USER_ID=$(echo $REGISTER_RESPONSE | jq -r '.user.id')

echo -e "\n3. Token: $TOKEN"
echo "User ID: $USER_ID"

echo -e "\n4. Buscando perfil..."
curl -s $API_URL/api/users/me/profile \
  -H "Authorization: Bearer $TOKEN" | jq

echo -e "\n5. Dashboard stats..."
curl -s $API_URL/api/dashboard/stats \
  -H "Authorization: Bearer $TOKEN" | jq
```

## 🔧 Ferramentas Úteis

### Usando Postman/Insomnia

1. Importe as rotas da API
2. Configure variável de ambiente `API_URL`
3. Configure variável `TOKEN` após login
4. Use `{{API_URL}}` e `{{TOKEN}}` nas requisições

### Usando jq (para formatar JSON)

```bash
# Instalar jq (macOS)
brew install jq

# Usar
curl ... | jq
```

## ⚠️ Troubleshooting

### Erro 401 (Não autorizado)
- Verifique se o token está correto
- Verifique se o header `Authorization: Bearer TOKEN` está presente

### Erro 404 (Não encontrado)
- Verifique se a URL está correta
- Verifique se o serviço está rodando no Render

### Erro 500 (Erro interno)
- Verifique os logs no Render
- Verifique se o banco de dados está configurado corretamente

### Imagens não aparecem
- Verifique se a tabela `Image` foi criada
- Verifique se o upload foi bem-sucedido
- Verifique se a URL da imagem está correta

## 📱 Testando com Flutter

```dart
// Exemplo de upload de imagem
final request = http.MultipartRequest(
  'POST',
  Uri.parse('$apiUrl/api/images/upload/user/$userId'),
);
request.headers['Authorization'] = 'Bearer $token';
request.files.add(await http.MultipartFile.fromPath('image', imagePath));
request.fields['isPrimary'] = 'true';

final response = await request.send();
```

## 🌐 Testando com Next.js

```typescript
// Exemplo de upload de imagem
const formData = new FormData();
formData.append('image', file);
formData.append('isPrimary', 'true');

const response = await fetch(`${API_URL}/api/images/upload/user/${userId}`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
  },
  body: formData,
});
```
