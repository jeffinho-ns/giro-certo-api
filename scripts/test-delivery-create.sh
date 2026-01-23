#!/bin/bash
# Testa login + criar pedido de delivery.
# Uso: ./scripts/test-delivery-create.sh [API_URL]
# Opcional: LOGIN_EMAIL e LOGIN_PASSWORD (ex: teste@reservarooftop.com.br)

API_URL="${1:-https://giro-certo-api.onrender.com}"
EMAIL="${LOGIN_EMAIL:-teste@reservarooftop.com.br}"
PASSWORD="${LOGIN_PASSWORD:-}"

if [ -z "$PASSWORD" ]; then
  echo "⚠️  Defina LOGIN_PASSWORD (e opcionalmente LOGIN_EMAIL) para testar como lojista."
  echo "   Ex: LOGIN_PASSWORD='sua_senha' ./scripts/test-delivery-create.sh"
  exit 1
fi

echo "🔐 Login: $EMAIL"
LOGIN=$(curl -s -X POST "$API_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
TOKEN=$(echo "$LOGIN" | jq -r '.token // empty')
USER_JSON=$(echo "$LOGIN" | jq -r '.user // empty')
PARTNER_ID=$(echo "$LOGIN" | jq -r '.user.partnerId // empty')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "❌ Login falhou: $LOGIN"
  exit 1
fi
echo "✅ Token obtido. partnerId=$PARTNER_ID"

# Usar store do usuário ou um fallback para teste
STORE_ID="${PARTNER_ID:-mkpjdyzkvafmy283ogi}"
STORE_NAME=$(echo "$LOGIN" | jq -r '.user.name // "Loja Teste"')

echo ""
echo "📦 Criar pedido (storeId=$STORE_ID)..."
BODY=$(jq -n \
  --arg sid "$STORE_ID" \
  --arg sn "$STORE_NAME" \
  '{storeId:$sid,storeName:$sn,storeAddress:"Rua Exemplo, 100",storeLatitude:-23.5505,storeLongitude:-46.6333,deliveryAddress:"Rua Destino, 200",deliveryLatitude:-23.5515,deliveryLongitude:-46.6343,recipientName:"Cliente Teste",recipientPhone:"11999999999",value:50,deliveryFee:8,priority:"normal"}')
CREATE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/delivery" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$BODY")
HTTP_BODY=$(echo "$CREATE" | head -n -1)
HTTP_CODE=$(echo "$CREATE" | tail -n 1)

echo "HTTP $HTTP_CODE"
echo "$HTTP_BODY" | jq '.' 2>/dev/null || echo "$HTTP_BODY"

if [ "$HTTP_CODE" = "201" ]; then
  echo ""
  echo "✅ Pedido criado com sucesso."
  echo "📋 Listar pedidos: curl -s \"$API_URL/api/delivery?limit=5\" -H \"Authorization: Bearer $TOKEN\" | jq ."
else
  echo "❌ Falha ao criar pedido."
  exit 1
fi
