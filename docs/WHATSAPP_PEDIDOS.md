# Pedidos via WhatsApp (cliente → loja → sistema)

Fluxo alvo:

1. Cliente fala com a loja no **WhatsApp Business** (número conectado à Meta).
2. Lojista envia o **texto modelo** (app → Pagamentos → copiar mensagem).
3. Cliente responde com os campos preenchidos.
4. A API recebe o webhook, cria o `DeliveryOrder`, gera cobrança Asaas e **responde no WhatsApp** com link de pagamento (+ PIX copia e cola se disponível).

## Pré-requisitos

- Migração: `npm run db:migrate:partner-whatsapp`
- Asaas configurado (cobrança)
- Env na API:

```env
WHATSAPP_CLOUD_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=
API_PUBLIC_URL=https://giro-certo-api.onrender.com
```

## Configuração Meta (resumo)

1. [Meta for Developers](https://developers.facebook.com/) → app → **WhatsApp** → API Setup.
2. Copie **Phone number ID** e gere **Access token** permanente.
3. **Webhook**:
   - URL: `https://<sua-api>/api/webhooks/whatsapp`
   - Verify token: igual a `WHATSAPP_VERIFY_TOKEN`
   - Assine o campo **messages**
4. No admin (ou SQL), na loja:

```http
PATCH /api/partners/:partnerId/whatsapp-settings
Authorization: Bearer <ADMIN>
{ "phone_number_id": "123456789", "enabled": true }
```

Piloto com uma loja: `WHATSAPP_DEFAULT_PARTNER_ID=<id>` + `whatsapp_orders_enabled=true`.

## App lojista

**Configurações → Pagamentos → Pedidos pelo WhatsApp** → copiar modelo e enviar ao cliente.

## Formato da resposta do cliente

Obrigatório (linhas):

- Nome, Telefone, **CPF**, Endereço completo, Valor do item, Confirmação: Sim

Mensagens que não seguem o modelo são ignoradas (conversa normal).

## Endpoints

| Método | Rota | Uso |
|--------|------|-----|
| GET | `/api/webhooks/whatsapp` | Verificação Meta |
| POST | `/api/webhooks/whatsapp` | Mensagens recebidas |
| GET | `/api/partners/me/whatsapp-order-template` | Lojista: texto modelo |
| POST | `/api/delivery/webhook/whatsapp-order` | Fallback manual (colar texto) |

## Operação

- Pré-pago: pedido fica `awaiting_dispatch` até pagamento; cliente paga pelo link; loja despacha no app.
- PIN na entrega: últimos 4 dígitos do telefone informado no pedido.
