# Go-live — Serviço de entrega (MVP)

Plano operacional para colocar em produção o **fluxo de entrega** (lojista → motoqueiro → admin), incluindo **pagamentos Asaas** já fechados nas fases 1–4. Social, gamificação ampla e disputas avançadas ficam fora do escopo deste cutover.

**Documentos relacionados**

| Documento | Uso |
|-----------|-----|
| [SMOKE_TEST_E2E_GIRO_CERTO.md](../SMOKE_TEST_E2E_GIRO_CERTO.md) | Validação E2E entrega (3 perfis) |
| [PLAYBOOK_OPERACIONAL_GIRO_CERTO.md](../PLAYBOOK_OPERACIONAL_GIRO_CERTO.md) | Dia a dia pós go-live |
| [PANORAMA_PRODUTO_PAGAMENTOS_E_ADMIN.md](./PANORAMA_PRODUTO_PAGAMENTOS_E_ADMIN.md) | Pagamentos §6.10 |
| [giro-certo-next/DEPLOY.md](../../giro-certo-next/DEPLOY.md) | Painel admin |

---

## 1. Objetivo e critério de sucesso

**Objetivo:** uma ou poucas lojas piloto + entregadores aprovados conseguem criar pedido, cobrar (conforme modo), despachar, executar corrida com código de retirada e concluir — com visibilidade no admin e repasses preparados (sandbox ou produção Asaas).

**Go** quando todos os itens da secção 7 estiverem ✅ e o smoke E2E + smoke pagamentos estiverem verdes.

---

## 2. Estratégia de rollout (recomendada)

| Fase | Duração sugerida | O quê |
|------|------------------|--------|
| **T0 — Preparação** | 2–5 dias | Migrações prod, env, webhook, 1 loja + 2 riders de teste |
| **T1 — Piloto fechado** | 1–2 semanas | 1–3 lojas reais, riders cadastrados/aprovados, Asaas **sandbox** ou produção com valores baixos |
| **T2 — Piloto ampliado** | 2–4 semanas | Mais lojas na mesma região; ativar repasses reais (`ASAAS_ENABLE_PAYOUTS`) se contabilidade OK |
| **T3 — Produção aberta** | após métricas | Convite gradual; modos `postpaid_pix` só se operação treinada |

**Modo de cobrança inicial recomendado:** `prepaid` (menos surpresas no despacho). Introduzir `postpaid_pix` depois que a loja dominar o fluxo.

---

## 3. Infraestrutura

### 3.1 Serviços

| Componente | Onde | URL / nota |
|------------|------|------------|
| API + WebSocket | Render (`giro-certo-api`) | `https://giro-certo-api.onrender.com` |
| PostgreSQL | Render (`dpg-*`) | `DATABASE_URL` na API |
| Admin | Vercel/Render (`giro-certo-next`) | `NEXT_PUBLIC_API_URL` = API pública |
| App mobile | TestFlight / APK interno / Play Internal | `ApiService.baseUrl` → API prod |

### 3.2 Migrações (produção — ordem obrigatória)

Executar na máquina CI ou local com `DATABASE_URL` de **produção** (backup antes):

```bash
cd giro-certo-api
npm run db:migrate:delivery-logistics          # se ainda não aplicada
npm run db:migrate:delivery-registration-schema
npm run db:migrate:user-fcm-tokens
npm run db:migrate:delivery-payment
npm run db:migrate:delivery-settlement-ledger
npm run db:migrate:delivery-settlement-batches
npm run db:migrate:payout-bank-profile
```

> Scripts idempotentes (`IF NOT EXISTS`); mesmo assim, **backup** do Postgres antes do bloco.

### 3.3 Variáveis de ambiente — API (Render)

| Variável | Obrigatório | Notas |
|----------|-------------|--------|
| `DATABASE_URL` | Sim | SSL automático em Render |
| `JWT_SECRET` | Sim | Forte, único em prod |
| `NODE_ENV` | Sim | `production` |
| `CORS_ORIGIN` | Sim | Origens do admin (e dev se necessário) |
| `FIREBASE_*` | Recomendado | Upload imagens perfil/documentos |
| `ASAAS_API_KEY` | Sim (pagamentos) | Sandbox primeiro, depois prod |
| `ASAAS_ENV` | Sim | `sandbox` → `production` |
| `ASAAS_WEBHOOK_TOKEN` | Sim | Igual ao painel Asaas |
| `ASAAS_FALLBACK_PAYER_CPF` | Sandbox | CPF válido de teste |
| `GIRO_PLATFORM_FEE_*` | Sim | Taxas por pedido |
| `GIRO_SETTLEMENT_FEE_*` | Sim | Taxa por lote |
| `GIRO_CRON_SECRET` | Sim | Cron compose + reconcile |
| `ASAAS_ENABLE_PAYOUTS` | Fase T2+ | Só quando for repassar dinheiro real |

### 3.4 Cron jobs (Render ou externo)

Header em todos: `x-giro-cron-secret: <GIRO_CRON_SECRET>`.

| Job | Endpoint | Schedule sugerido |
|-----|----------|-------------------|
| Reconciliar Asaas | `POST /api/settlement/reconcile-scheduled` body `{}` | `*/30 * * * *` |
| Compor lotes | `POST /api/settlement/batches/compose-scheduled` body `{}` | `0 3 * * *` (03:00) |

Exemplo: [scripts/cron-settlement-example.sh](../scripts/cron-settlement-example.sh).

### 3.5 Asaas

1. Conta PJ configurada (sandbox para T1).
2. Webhook: `POST https://giro-certo-api.onrender.com/api/webhooks/asaas`
3. Cabeçalho: `asaas-access-token` = `ASAAS_WEBHOOK_TOKEN`
4. Eventos de cobrança (pagamento recebido / confirmado).

### 3.6 Admin (`giro-certo-next`)

```env
NEXT_PUBLIC_API_URL=https://giro-certo-api.onrender.com
NEXT_PUBLIC_WS_URL=wss://giro-certo-api.onrender.com
NEXT_PUBLIC_MAPBOX_TOKEN=<token Mapbox>
```

Deploy após push em `main` (conforme pipeline existente).

### 3.7 App Flutter

- `lib/services/api_service.dart`: `baseUrl` apontando para API de **produção** no build de release.
- iOS: `ios/MapboxKeys.xcconfig` a partir de `MapboxKeys.xcconfig.example`.
- Firebase / FCM: projeto alinhado ao da API para push em corrida.
- Build release: versionar `version` + `build number` antes de distribuir.

---

## 4. Preparação de dados e acessos

| Item | Responsável | Ação |
|------|-------------|------|
| Utilizador **ADMIN** | Ops / eng | `npm run create:admin` ou existente |
| **Loja piloto** | Ops | Criar `Partner` + usuário lojista vinculado (`partnerId`) |
| **Riders** | Ops | Cadastro + aprovação em `/dashboard/delivery-registrations` |
| Modo pagamento loja | Lojista | App → Configurações → Pagamentos (`prepaid` no piloto) |
| Conta repasse loja | Lojista | Mesmo ecrã (JSON bancário Asaas) |
| Conta repasse rider | Rider | Configurações → Repasse do entregador |

---

## 5. Testes obrigatórios pré go-live

### 5.1 Smoke entrega (obrigatório)

Seguir [SMOKE_TEST_E2E_GIRO_CERTO.md](../SMOKE_TEST_E2E_GIRO_CERTO.md) em ambiente que use **a mesma API** que irá para prod (ou staging idêntico).

Checklist resumido:

- [ ] Criar pedido com endereço Places válido
- [ ] Despacho / aceite sem conflito
- [ ] `arrivedAtStore` → `inTransit` só com código interno correto
- [ ] Reconexão socket após modo avião
- [ ] Conclusão + histórico de rota
- [ ] `GET /api/dashboard/delivery-sla?days=1` responde

### 5.2 Smoke pagamentos (obrigatório)

Ambiente com Asaas configurado (sandbox OK):

- [ ] Loja `prepaid`: `initiate` → pagar (link ou PIX) → webhook `paid`
- [ ] Despacho bloqueado até `paid`; após pago, despacho OK
- [ ] Rider aceita; linha no livro com `riderUserId` preenchido
- [ ] Admin: `/dashboard/settlements` — resumo pendente, **Compor lotes**
- [ ] (Opcional T2) **Repassar** com `ASAAS_ENABLE_PAYOUTS=true` e perfil bancário preenchido
- [ ] Cron reconcile: cobrança pendente no Asaas sincroniza para `paid` na BD

### 5.3 Painel admin

- [ ] Login admin
- [ ] Torre de controle: pedidos ativos
- [ ] Aprovação de entregadores
- [ ] Repasses Asaas

---

## 6. Dia D — sequência sugerida

1. **Manhã (janela baixa):** backup DB → migrações → deploy API → smoke API `GET /health`
2. Configurar / validar env e webhook Asaas
3. Deploy admin; login e torre de controle
4. Ativar cron reconcile + compose (compose pode esperar 24h após primeiro dia de pedidos pagos)
5. Distribuir build Flutter piloto (TestFlight/APK) só para loja + riders da lista
6. **Tarde:** 1 pedido real supervisionado (mesa de war room: lojista + rider + admin no Slack/WhatsApp)
7. Monitorar `delivery-sla`, logs Render, erros webhook Asaas

---

## 7. Go / No-go (checklist final)

| # | Critério | Go |
|---|----------|-----|
| 1 | Migrações aplicadas sem erro | ☐ |
| 2 | API e WS acessíveis publicamente | ☐ |
| 3 | Webhook Asaas testado (evento de teste ou pagamento sandbox) | ☐ |
| 4 | Smoke E2E entrega completo | ☐ |
| 5 | Smoke pagamentos (pelo menos prepaid + livro) | ☐ |
| 6 | ≥1 loja + ≥2 riders aprovados com app instalado | ☐ |
| 7 | Playbook operacional lido pela pessoa de plantão | ☐ |
| 8 | Rollback definido (secção 8) | ☐ |

**No-go** se: falha em código de retirada, duplicidade de aceite, webhook não atualiza `paid`, ou geocoding/rota indisponível na região piloto.

---

## 8. Rollback

| Camada | Ação |
|--------|------|
| API | Re-deploy commit anterior no Render (migrações já aplicadas **não** revertem automaticamente) |
| App | Manter build anterior; avisar lojistas para não atualizar |
| Pagamentos | Desativar novos `initiate` bloqueando loja (`isBlocked`) ou pausar webhook no Asaas |
| Dados | Restaurar backup Postgres só em incidente grave (RPO/RTO conforme política Render) |

---

## 9. Pós go-live (primeiras 2 semanas)

**Diário**

- `GET /api/dashboard/delivery-sla?days=1`
- Painel Repasses: pendências e lotes `transfer_failed`
- Logs: webhook Asaas, erros 402 `PAYMENT_REQUIRED_PREPAID`

**Semanal**

- Revisar conflitos de aceite e falhas de código de retirada
- Ajustar taxas env se margem divergir do esperado
- Decidir passagem T2 (`ASAAS_ENABLE_PAYOUTS`, mais lojas)

**Escalonamento:** ver [PLAYBOOK_OPERACIONAL_GIRO_CERTO.md](../PLAYBOOK_OPERACIONAL_GIRO_CERTO.md) §7.

---

## 10. Riscos e mitigação

| Risco | Mitigação |
|-------|-----------|
| Webhook Asaas falha → pedido não libera despacho (pré-pago) | Reconcile cron; botão admin para sync manual futuro |
| Rider sem conta repasse | Repasse manual via admin com `bankAccount` no POST até perfil preenchido |
| Mapbox/Places na região | Testar endereço real da loja piloto antes do D-day |
| Render cold start | Keep-alive ou aceitar latência no primeiro request |
| Lojista em modo errado | Treinamento + default `prepaid` |

---

## 11. Backlog pós go-live (não bloqueia T1)

- Disputas operacionais completas no app
- Extrato financeiro vs Asaas
- `authorize_capture` com captura tardia nativa Asaas
- Lojas em massa / self-service sem ops manual

---

*Última atualização: alinhado às fases de pagamento 1–4 e commits em `main` (API, Flutter, Next).*
