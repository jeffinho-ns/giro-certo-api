# Go-Live Dia 0 — Checklist (piloto)

> Checklist curto para o dia do deploy em produção (Render + Next).  
> Plano de 2 semanas: [`GO_LIVE_2_SEMANAS.md`](./GO_LIVE_2_SEMANAS.md).  
> Lista completa de envs: [`check-production-env.md`](./check-production-env.md).

**Não coloque senhas, connection strings nem chaves neste arquivo.** Configure só no painel (Render / Vercel).

---

## 1) Ordem de deploy

1. **Postgres** no Render já ativo (backup se for migração).
2. **API** (`giro-certo-api`) no Render — com envs de produção preenchidas.
3. Confirmar `GET /health` com `"db": "up"`.
4. Configurar **webhook Asaas** apontando para a API de produção.
5. **Next** (`giro-certo-next`) — com `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_WS_URL` apontando para a API.
6. Atualizar `CORS_ORIGIN` na API com o domínio real do Next (e redeploy se necessário).
7. Smoke de 30 minutos (secção 6).

> App Flutter em debug nos telefones de casa continua OK para o piloto. Publicação nas lojas fica para o final do projeto.

---

## 2) Variáveis obrigatórias — API (Render)

Validação no startup (`assertProductionEnv` em `src/utils/startup-env.ts`): com `NODE_ENV=production`, a API **não sobe** se faltar o bloco abaixo.

| Variável | Para quê |
|----------|----------|
| `NODE_ENV` | Deve ser `production` (ativa a validação fail-fast). |
| `DATABASE_URL` | Postgres (Render). Sem isso, health fica `db: down`. |
| `JWT_SECRET` | Assina tokens. Mín. 16 caracteres; **não** use o default `your-secret-key`. |
| `ASAAS_API_KEY` | Cria cobranças PIX / pagamentos. |
| `ASAAS_WEBHOOK_TOKEN` | Valida header `asaas-access-token` no webhook (fail-closed). |

### Fortemente recomendadas no piloto

| Variável | Para quê |
|----------|----------|
| `CORS_ORIGIN` | Origens do Next (ex.: `https://seu-dominio.vercel.app`). Várias: separadas por vírgula. |
| `ASAAS_ENV` | `sandbox` no piloto controlado, ou `production` com chave real. |
| `API_URL` / `API_PUBLIC_URL` | URL pública da API (uploads, links, WhatsApp). |
| `GIRO_CRON_SECRET` | Se for ativar cron de settlement/reconcile (`x-giro-cron-secret`). |
| `GOOGLE_MAPS_SERVER_KEY` | Rotas / geocode / Places no servidor (melhor UX; há fallback parcial). |
| `FIREBASE_*` | Upload de imagens (perfil, produtos, docs). Sem isso, uploads falham. |

Detalhes e opcionais: [`check-production-env.md`](./check-production-env.md).

---

## 3) Variáveis — Next (Vercel / host)

| Variável | Para quê |
|----------|----------|
| `NEXT_PUBLIC_API_URL` | Base HTTP da API (ex.: `https://giro-certo-api.onrender.com`). |
| `NEXT_PUBLIC_WS_URL` | WebSocket (ex.: `wss://giro-certo-api.onrender.com`). |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Mapa no admin / tracking (se usado no build). |

**Importante:** `NEXT_PUBLIC_*` entra no bundle do browser. Depois de mudar, **redeploy** o Next.  
Guia: `giro-certo-next/DEPLOY.md`.

---

## 4) Health check

```bash
curl -sS https://SEU-HOST-API/health
```

Esperado (HTTP 200):

```json
{ "status": "ok", "db": "up", "message": "Giro Certo API is running" }
```

Se `"db": "down"` ou HTTP 503 → checar `DATABASE_URL` / Postgres no Render. **Não** siga o deploy do Next até o DB estar `up`.

---

## 5) Webhook Asaas

No painel Asaas (sandbox ou produção, alinhado a `ASAAS_ENV` / chave):

| Campo | Valor |
|-------|--------|
| URL | `https://SEU-HOST-API/api/webhooks/asaas` |
| Header | `asaas-access-token` = mesmo valor de `ASAAS_WEBHOOK_TOKEN` |
| Eventos | Pagamento recebido / confirmado (cobrança) |

Sem webhook válido, PIX pago **não** libera o pedido para despacho.

---

## 6) Smoke de 30 min (pós-deploy)

Marque na hora:

- [ ] `GET /health` → `db: up`
- [ ] Login admin no Next (`/login` → `/dashboard`)
- [ ] Abrir vitrine `/loja/<slug>` no celular
- [ ] Checkout + PIX (sandbox ou valor baixo em prod)
- [ ] Webhook: pedido muda para pago (sem intervenção manual)
- [ ] Lojista aceita pedido (portal ou app)
- [ ] Rider online aceita → código loja → PIN cliente → concluir
- [ ] `/pedido/<token>`: status + mapa do rider (se em rota)
- [ ] CORS: sem erro de origin no DevTools do Next

Roteiro completo em casa: [`SMOKE_TEST_CASA.md`](./SMOKE_TEST_CASA.md) (já executado no ambiente de teste).

---

## 7) Domínios — lembrete rápido

| Onde | O quê |
|------|--------|
| Render (API) | `CORS_ORIGIN` = URL(s) do Next |
| Vercel (Next) | `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_WS_URL` = URL da API |
| Asaas | Webhook = `…/api/webhooks/asaas` |
| App Flutter (debug) | `--dart-define=API_URL=…` e opcional `WEB_URL=…` (link da vitrine) |

---

## 8) Rollback rápido

| Camada | Ação |
|--------|------|
| API | Redeploy do commit anterior no Render |
| Next | Redeploy / rollback na Vercel |
| Pagamentos | Pausar webhook no Asaas se estiver gerando estado inconsistente |
| DB | Restaurar backup só em incidente grave (migrações já aplicadas não revertem sozinhas) |

Mais detalhe operacional: [`GO_LIVE_ENTREGA.md`](./GO_LIVE_ENTREGA.md).

---

## 9) Critério de “go-live piloto” (produção)

Marque **só depois** do smoke da secção 6 em **produção** (não só em casa):

- [ ] API + Next de produção estáveis (`/health` ok, vitrine abre)
- [ ] 1 loja piloto + 1–2 entregadores aprovados
- [ ] Cliente paga PIX na vitrine → entrega conclui
- [ ] Pedido aparece em `/dashboard/settlements` → **Compor lotes** ok
- [ ] Admin opera sozinho (aprovar delivery, torre, lotes)

App nos telefones do piloto: `giro-certo-flutter/docs/PILOTO_BUILD.md`.  
Operação diária: `giro-certo-next/docs/OPERACAO_PILOTO.md` + `ADMIN_GO_LIVE.md`.  
Publicação nas lojas: **depois** — `giro-certo-flutter/docs/RELEASE_CHECKLIST.md`.
