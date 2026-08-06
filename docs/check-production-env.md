# Checklist de variáveis — produção (piloto)

> Só **nomes** e propósito. Valores ficam no painel Render / Vercel — nunca neste repo.  
> Dia 0: [`GO_LIVE_DIA_0.md`](./GO_LIVE_DIA_0.md).

A API chama `assertProductionEnv()` no boot (`src/utils/startup-env.ts`). Com `NODE_ENV=production`, processo **encerra** se faltar o bloco obrigatório.

---

## API (`giro-certo-api` no Render)

### Obrigatórias (startup falha sem elas)

| Nome | Propósito |
|------|-----------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Conexão PostgreSQL |
| `JWT_SECRET` | JWT (≥16 chars; não usar default fraco) |
| `ASAAS_API_KEY` | API Asaas (cobranças) |
| `ASAAS_WEBHOOK_TOKEN` | Auth do webhook (`asaas-access-token`) |

### Recomendadas no piloto

| Nome | Propósito |
|------|-----------|
| `PORT` | Porta HTTP (Render costuma injetar) |
| `CORS_ORIGIN` | Origens do Next (vírgula se várias) |
| `ASAAS_ENV` | `sandbox` ou `production` |
| `ASAAS_API_URL` | Opcional; sobrescreve URL base do Asaas |
| `ASAAS_USER_AGENT` | User-Agent nas chamadas Asaas |
| `ASAAS_FALLBACK_PAYER_CPF` | CPF de teste (sandbox) quando pedido sem documento |
| `API_URL` | URL pública da API (uploads / links) |
| `API_PUBLIC_URL` | URL pública (WhatsApp / webhooks Meta) |
| `GIRO_CRON_SECRET` | Header `x-giro-cron-secret` nos crons de settlement |
| `GIRO_PLATFORM_FEE_STORE_FIXED` | Taxa plataforma loja (default no código se omitir) |
| `GIRO_PLATFORM_FEE_RIDER_PER_ORDER` | Taxa plataforma rider |
| `GIRO_SETTLEMENT_FEE_DAILY` / `_WEEKLY` / `_MONTHLY` | Taxas de lote |
| `GOOGLE_MAPS_SERVER_KEY` | Rotas, Directions, Places no servidor |
| `FIREBASE_STORAGE_BUCKET` | Bucket de imagens |
| `FIREBASE_ADMIN_PROJECT_ID` | Admin SDK |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Admin SDK |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Admin SDK (ou use o JSON em base64) |
| `FIREBASE_ADMIN_CREDENTIALS_JSON_BASE64` | Alternativa às três credenciais acima |

### Opcionais / fase posterior

| Nome | Propósito |
|------|-----------|
| `ASAAS_ENABLE_PAYOUTS` | Só quando for executar repasse real via Asaas |
| `GIRO_SETTLEMENT_WAIVE_BATCH_FEES` | Piloto: zerar taxa de lote |
| `JSON_PAYLOAD_LIMIT` | Limite body (default alto para base64) |
| `WHATSAPP_*` | Cloud API (se piloto WhatsApp ativo) |

---

## Next (`giro-certo-next`)

| Nome | Propósito |
|------|-----------|
| `NEXT_PUBLIC_API_URL` | Base HTTP da API de produção |
| `NEXT_PUBLIC_WS_URL` | Base WebSocket (`wss://…`) |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Mapas no front (se o build usar) |

Ver também `giro-certo-next/DEPLOY.md`.

---

## Como conferir antes do deploy

No painel Render, confirme que **existem** (sem colar valores em chat/commit):

1. `NODE_ENV`, `DATABASE_URL`, `JWT_SECRET`
2. `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`
3. `CORS_ORIGIN` alinhado ao domínio do Next
4. (Recomendado) `GOOGLE_MAPS_SERVER_KEY`, Firebase, `GIRO_CRON_SECRET` se for ligar cron

Depois do deploy:

```bash
curl -sS https://SEU-HOST-API/health
# esperado: "db": "up"
```

Se a API não sobe e os logs mostram `Ambiente de produção inválido`, falta alguma obrigatória da secção de startup.
