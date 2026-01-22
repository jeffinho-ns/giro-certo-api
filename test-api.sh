#!/bin/bash

# Script de teste para a API Giro Certo
# Uso: ./test-api.sh YOUR_API_URL

if [ -z "$1" ]; then
  echo "❌ Erro: Forneça a URL da API"
  echo "Uso: ./test-api.sh https://giro-certo-api.onrender.com"
  exit 1
fi

API_URL="$1"
echo "🧪 Testando API em: $API_URL"
echo ""

# 1. Health Check
echo "1️⃣ Health Check..."
HEALTH=$(curl -s "$API_URL/health")
echo "$HEALTH" | jq '.' 2>/dev/null || echo "$HEALTH"
echo ""

# 2. Registrar usuário
echo "2️⃣ Registrando novo usuário..."
TIMESTAMP=$(date +%s)
REGISTER_RESPONSE=$(curl -s -X POST "$API_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Test User $TIMESTAMP\",
    \"email\": \"test$TIMESTAMP@example.com\",
    \"password\": \"test123456\",
    \"age\": 25,
    \"pilotProfile\": \"URBANO\"
  }")

echo "$REGISTER_RESPONSE" | jq '.' 2>/dev/null || echo "$REGISTER_RESPONSE"

# Extrair token e user ID
TOKEN=$(echo "$REGISTER_RESPONSE" | jq -r '.token // empty' 2>/dev/null)
USER_ID=$(echo "$REGISTER_RESPONSE" | jq -r '.user.id // empty' 2>/dev/null)

if [ -z "$TOKEN" ] || [ "$TOKEN" == "null" ]; then
  echo "❌ Falha ao registrar usuário. Tentando login..."
  
  # Tentar login com usuário existente
  LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{
      \"email\": \"test@example.com\",
      \"password\": \"test123456\"
    }")
  
  TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.token // empty' 2>/dev/null)
  USER_ID=$(echo "$LOGIN_RESPONSE" | jq -r '.user.id // empty' 2>/dev/null)
fi

if [ -z "$TOKEN" ] || [ "$TOKEN" == "null" ]; then
  echo "❌ Não foi possível obter token. Verifique as credenciais."
  exit 1
fi

echo ""
echo "✅ Token obtido: ${TOKEN:0:20}..."
echo "✅ User ID: $USER_ID"
echo ""

# 3. Buscar perfil
echo "3️⃣ Buscando perfil do usuário..."
PROFILE=$(curl -s "$API_URL/api/users/me/profile" \
  -H "Authorization: Bearer $TOKEN")
echo "$PROFILE" | jq '.' 2>/dev/null || echo "$PROFILE"
echo ""

# 4. Dashboard stats
echo "4️⃣ Buscando estatísticas do dashboard..."
STATS=$(curl -s "$API_URL/api/dashboard/stats" \
  -H "Authorization: Bearer $TOKEN")
echo "$STATS" | jq '.' 2>/dev/null || echo "$STATS"
echo ""

# 5. Wallet
echo "5️⃣ Buscando wallet..."
WALLET=$(curl -s "$API_URL/api/wallet/me" \
  -H "Authorization: Bearer $TOKEN")
echo "$WALLET" | jq '.' 2>/dev/null || echo "$WALLET"
echo ""

# 6. Listar bikes
echo "6️⃣ Listando motos do usuário..."
BIKES=$(curl -s "$API_URL/api/bikes/me/bikes" \
  -H "Authorization: Bearer $TOKEN")
echo "$BIKES" | jq '.' 2>/dev/null || echo "$BIKES"
echo ""

echo "✅ Testes concluídos!"
echo ""
echo "📝 Para testar upload de imagem, use:"
echo "curl -X POST $API_URL/api/images/upload/user/$USER_ID \\"
echo "  -H \"Authorization: Bearer $TOKEN\" \\"
echo "  -F \"image=@/caminho/para/imagem.jpg\" \\"
echo "  -F \"isPrimary=true\""
