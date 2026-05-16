# Panorama de produto, app, admin e pagamentos (Asaas)

Documento de referência para **novas implementações**. Consolida alinhamentos de produto (incluindo **pagamentos — Fase 0**) e um panorama do ecossistema.  
**Última atualização:** produto/pagamentos acordados antes da Fase 1 técnica (integração Asaas).

Para inventário técnico detalhado do mobile e tabelas, ver também:  
[`giro-certo-flutter/PANORAMA_GERAL.md`](../../giro-certo-flutter/PANORAMA_GERAL.md).

---

## 1. Ecossistema Giro Certo

| Componente | Stack | Função |
|--------------|-------|--------|
| **giro-certo-flutter** | Flutter | App único: motociclista (mapa/delivery), lojista (dashboard), fluxos sociais/onboarding conforme tipo de utilizador |
| **giro-certo-api** | Node.js, TypeScript, Express, PostgreSQL, Socket.io | API REST + tempo real (chat, delivery, notificações) |
| **giro-certo-next** | Next.js 14+, dashboard admin | Painel **Torre de Controle**, delivery, financeiro (evolução), moderação social, etc. |
| **PostgreSQL** | (ex.: Render) | Dados persistentes |

Fluxo nominal de delivery: lojista cria pedido → sistema notifica riders → rider aceita → estados até `completed` → (hoje) **wallet interna** pode creditar comissão ao rider conforme `appCommission` — **sem gateway de pagamento ao cliente final até implementação Asaas**.

---

## 2. Panorama do app mobile (Flutter)

### Perfis de utilizador

- **Motociclista / piloto:** mapa principal (`HomeScreen`), registo delivery opcional (`DeliveryRegistration`), aceitar corridas, navegação Mapbox (`TripNavigationScreen`), prova de entrega (PIN).
- **Lojista (partner):** home dedicada (`PartnerHomeScreen`) — lista em tempo real, chamados WhatsApp/app, novo pedido, cards com rider clicável para detalhes e foto ampliável; **sem mapa no topo** e **sem barra inferior global** no modo lojista (navegação focada).
- **Casual / social:** home social quando aplicável (`SocialHomeScreen`), conforme `AppStateProvider` / onboarding.

### Tempo real

- **Socket.io** (`RealtimeService`): ofertas de corrida, atualizações de estado do pedido, notificações, localização rider (throttle).
- Eventos úteis para lojista: `delivery:update`, `delivery:status:changed`, `delivery:store_refresh` (reload controlado da lista).

### Delivery — trechos relevantes para pagamentos futuros

- Pedido com `value` (item), `deliveryFee` (frete), `appCommission` (campo já usado na conclusão para crédito interno na wallet).
- Estados operacionais cobrem desde despacho até `completed` com PIN do cliente.

---

## 3. Panorama do admin (`giro-certo-next`)

Painel administrativo consumindo a mesma API (`NEXT_PUBLIC_API_URL`).

Áreas descritas no README do projeto (evolução contínua):

- **Torre de Controle** — mapa, visão operacional.
- **Gestão de delivery** — acompanhamento de pedidos.
- **Financeiro** — relatórios / repasses (a alinhar com o novo modelo Asaas quando existir).
- **Assinantes / gamificação / moderação social.**

### Papéis na API (relevante para admin)

- **ADMIN** — ações sensíveis (ex.: aprovar registo delivery `PUT /api/delivery-registration/:id/status`).
- **MODERATOR** — listagens e revisões parciais.
- **USER** — app standard.

Ver [`README_ROLES.md`](../README_ROLES.md).

---

## 4. Backend — módulos já úteis para dinheiro (pré-Asaas)

- **`DeliveryOrder`** — valores e comissões.
- **`Wallet` / `WalletTransaction`** — ao concluir pedido, pode creditar rider com base em `appCommission` (livro-caixa interno, **não** é PIX recebido do cliente).
- **`PartnerPayment`** — planos do **parceiro com a plataforma** (mensalidade / % pedido, inadimplência, alertas `PAYMENT_OVERDUE`). **Distinto** da futura cobrança **cliente → pedido**.
- **`DeliveryRegistration`** — KYC delivery; aprovação dispara alerta + push ao rider.

Nada disto substitui **cobrança ao cliente final** nem **split real** via Asaas — são bases de dados e regras internas.

---

## 5. Pagamentos — decisões de produto (Fase 0, fechadas)

Esta secção é a **fonte da verdade** até abrir implementação (Fase 1).

### 5.1 Quem paga (v1)

| Ator | O quê |
|------|--------|
| **Cliente** | Paga **só um total** no checkout (ver fórmula abaixo). O dinheiro entra na estrutura da plataforma (conta Asaas do dono do app); o **split lógico** define repasses. |
| **Lojista** | **Mensalidade fixa** (relação loja ↔ plataforma, em paralelo ao checkout do pedido). |
| **Motociclista** | **Sem cobrança direta separada na v1** para o “R$ 1 por corrida”: esse valor sai do **mesmo pagamento do cliente**, descontando o **líquido repassado ao rider** sobre o frete. |
| **Assinaturas rider / cliente** | **Fora da v1** (V2). |

### 5.2 Fórmula apresentada ao cliente (exemplo de referência)

- **Item:** R$ 30,00  
- **Frete:** R$ 9,00  
- **Taxa do app (transparência):** R$ 2,00 — **não aumenta** o que o cliente paga; é **abatida no repasse ao lojista**.  
- **Total cobrado ao cliente:** **R$ 39,00** (30 + 9).

**Repasse lógico de referência (mesmo exemplo):**

- Cliente paga **R$ 39**.  
- Lojista: face ao item de **R$ 30**, após taxa de app **R$ 2** → **líquido típico ao lojista = R$ 28**.  
- Motociclista: face ao frete **R$ 9**, com **R$ 1** por corrida retido pela plataforma (v1, sem assinatura rider) → **líquido típico ao rider = R$ 8**.  
- **Plataforma (neste exemplo):** R$ 2 + R$ 1 = **R$ 3** por pedido concluído e pago nesta lógica.

*Valores reais sempre derivados dos campos do pedido (`value`, `deliveryFee`) e das regras/tabelas de taxas versionadas.*

### 5.3 Quando cobrar — três modos (v1)

Todos **aceites**; o **lojista escolhe no cadastro** da loja qual política usar:

| Modo | Descrição |
|------|-----------|
| **A — Pré-pagamento** | Cliente paga **antes** de despachar / antes de aceitar moto. |
| **B — Pós-pagamento (PIX na entrega)** | Pagamento **no ato da entrega**, **somente PIX** (não é maquininha). |
| **C — Autorização + captura** | Cartão: **autorizar** no aceite; **capturar** na entrega. |

Instrumentos: **link/checkout** permite **crédito e débito**; **PIX** conforme modo B e regras Asaas.

Implica **máquina de estados financeira** paralela à logística e validação por **webhook** (não confiar só no cliente).

### 5.4 Split operacional e liquidação (repasses agendados)

- **Split lógico** no momento do pagamento (quanto é de loja, rider, plataforma).  
- **Liquidação física** com **preferências configuráveis**:  
  - **Rider:** padrão **fim do dia** (agregado).  
  - **Lojista:** padrão **fim da semana** (agregado).  
- **Periodicidade configurável** com **taxa de uso** (exemplos acordados para desenho):  
  - Repasse **diário** → taxa tipo **R$ 2 por transação** de repasse.  
  - **Semanal** → **R$ 50 fixo** (por período/ciclo — detalhar na spec técnica).  
  - **Mensal** → **R$ 40 fixo**.

*Confirmar na documentação Asaas e com contador: uma conta PJ, cobranças, transferências PIX/TED para contas cadastradas de lojistas e riders, custos e D+N.*

### 5.5 Modelo “só eu tenho Asaas”

- **Viável:** uma conta **Asaas da empresa** recebe; **repasses** para IBAN/contas cadastradas dos parceiros.  
- **Não dispensa** contrato/KYC dos beneficiários e trilho contábil de **intermediação**.  
- Subcontas Asaas por loja/rider podem ser **fase posterior** se o produto Asaas facilitar split nativo.

### 5.6 Impostos e nota fiscal

- **NF do item:** **responsabilidade do lojista** (cliente compra produto da loja).  
- Receitas da **plataforma** (mensalidades, taxas, comissões): tratar com contador **à parte**.

### 5.7 Disputas (backlog)

- Reembolso parcial com retenção de taxas e pendência no cliente — **fora do escopo da Fase 1 técnica inicial**.

---

## 6. Fase 1 técnica — implementado na API (`giro-certo-api`)

### 6.1 Migração base de dados

- Script: `scripts/migrate-delivery-payment-asaas.sql`  
- Comando: `npm run db:migrate:delivery-payment`  
- Tabela **`DeliveryPayment`**: valores do checkout, snapshots de split (`platformFeeStore`, `platformFeeRider`, `storeNetSnapshot`, `riderNetSnapshot`), `idempotencyKey`, IDs Asaas, `invoiceUrl`, estado, webhook payload.  
- Coluna **`Partner.delivery_payment_collection_mode`**: `prepaid` | `postpaid_pix` | `authorize_capture` (default `prepaid`).

### 6.2 Variáveis de ambiente

Ver `.env.example`: `ASAAS_API_KEY`, `ASAAS_ENV`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_FALLBACK_PAYER_CPF`, `GIRO_PLATFORM_FEE_*`, opcional `ASAAS_API_URL`, `ASAAS_USER_AGENT`.

### 6.3 Endpoints

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/api/delivery/:orderId/payments/initiate` | Bearer lojista da loja ou ADMIN | Cria cliente + cobrança Asaas (`billingType` opcional: `UNDEFINED`, `PIX`, …). Body opcional: `idempotencyKey`, `billingType`. Header opcional: `Idempotency-Key`. |
| GET | `/api/delivery/:orderId/payments/latest` | Bearer lojista ou ADMIN | Último registro de pagamento do pedido. |
| PATCH | `/api/partners/me/delivery-payment-collection-mode` | Bearer lojista | Body `{ "mode": "prepaid" \| "postpaid_pix" \| "authorize_capture" }`. |
| POST | `/api/webhooks/asaas` | Cabeçalho `asaas-access-token` = `ASAAS_WEBHOOK_TOKEN` | Webhook Asaas (JSON). |
| GET | `/api/settlement/ledger/pending-summary` | Bearer **ADMIN** | Totais ainda não alocados em lote (`pending` + sem `settlement_batch_id`). |
| POST | `/api/settlement/batches/compose-from-ledger` | Bearer **ADMIN** | Body opcional `{ "cutoffAt": "ISO8601" }`. Agrupa pendências por loja e rider. |
| GET | `/api/settlement/batches` | Bearer **ADMIN** | Query `limit`, `status` opcional. Lista lotes. |
| GET | `/api/settlement/batches/:batchId` | Bearer **ADMIN** | Detalhe do lote. |
| PATCH | `/api/partners/me/settlement-settings` | Bearer lojista | Body opcional `{ "frequency": "daily"\|"weekly"\|"monthly", "fee_flat_override": number \| null }` — define periodicidade para taxa de lote na loja. |
| PATCH | `/api/users/me/delivery-settlement-settings` | Bearer usuário | Idem rider (opcional `{ "frequency": null }` volta ao default do env). |
| POST | `/api/settlement/batches/compose-scheduled` | Header `x-giro-cron-secret` = **`GIRO_CRON_SECRET`** | Mesmo compose que o admin sem JWT — para Cron. Body opcional `{ "cutoffAt": "ISO8601" }`. |
| POST | `/api/settlement/batches/:batchId/execute-transfer` | Bearer **ADMIN** | Body opcional `{ "bankAccount": { … }, "description"?: string }`. Se **omitir** `bankAccount`, usa `payout_bank_account_json` do lojista (**partner**) ou do rider conforme o lote — exige migração Fase 3 e perfil preenchido. Requer `ASAAS_ENABLE_PAYOUTS=true`. |
| GET | `/api/partners/me/payout-bank-profile` | Bearer lojista | `{ "payout_bank_account": object \| null }` — dados salvos para repasse. |
| PATCH | `/api/partners/me/payout-bank-profile` | Bearer lojista | Body `{ "payout_bank_account": { … } \| null }` — grava objeto compatível Asaas `/transfers` ou `null` para limpar. |
| GET | `/api/users/me/payout-bank-profile` | Bearer usuário | Idem dados de repasse do rider. |
| PATCH | `/api/users/me/payout-bank-profile` | Bearer usuário | Idem PATCH lojista para o próprio utilizador rider. |
| POST | `/api/settlement/reconcile/payments` | Bearer **ADMIN** | Body opcional `{"limit": number}`. Sincroniza cobranças abertas com Asaas GET `/payments/:id`. |
| POST | `/api/settlement/reconcile/transfers` | Bearer **ADMIN** | Body opcional `{"limit": number}`. Lotes `transfer_done`: GET `/transfers/:id`; falha Asaas marca `transfer_failed`. |
| POST | `/api/settlement/reconcile-scheduled` | Header `x-giro-cron-secret` | Cron: mesmo efeito; body opc. `payments`/`transfers`/`paymentLimit`/`transferLimit`. |

**Webhook:** configurar URL pública no painel Asaas apontando para `POST .../api/webhooks/asaas`.

### 6.4 Regras atuais da cobrança “initiate”

- **`prepaid`** (modo pré-pago): só em **`awaiting_dispatch`** ou **`pending` sem rider aceito** (como antes).  
- **`postpaid_pix`** e **`authorize_capture`**: além desses dois estados antigos, permite **`initiate`** com pedido já em corrida (**`accepted`**, **`arrivedAtStore`**, **`inTransit`**, **`arrivedAtDestination`**, **`inProgress`**).  
- **`completed`** / **`cancelled`**: nunca permite nova cobrança.  
- **Snapshot de valores:** total ao cliente = `value + deliveryFee`; taxas fixas por env (`GIRO_PLATFORM_FEE_STORE_FIXED`, `GIRO_PLATFORM_FEE_RIDER_PER_ORDER`).  
- Telefone do destinatário obrigatório (10+ dígitos) para criar cliente Asaas.  
- **`authorize_capture`**: política já gravada na loja; integração técnica de “autorizar + capturar” com cartão no Asaas pode ser refinada mais tarde (`initiate` continua usando o fluxo de cobrança padrão enquanto isso).

### 6.5 Script Fase 3 — conta repasse beneficiário

- `scripts/migrate-payout-bank-profile.sql` → `npm run db:migrate:payout-bank-profile`  
- Colunas **`Partner.payout_bank_account_json`** e **`User.payout_bank_account_json`** (JSONB opcional).

### 6.6 Fase 2 — livro, lotes e compose (recap)

- Scripts: **`npm run db:migrate:delivery-settlement-ledger`** · **`npm run db:migrate:delivery-settlement-batches`** (nessa ordem).
- **`DeliverySettlementLedger`**: registada quando `DeliveryPayment` fica **`paid`**; **`riderUserId`** atualizado ao rider aceitar se ainda nulo.
- **`GET /api/settlement/ledger/pending-summary`**: totais `pending` agregados.
- **`Partner.delivery_settlement_frequency`** / **`fee_flat_override`** (e overrides em **`User`** para rider); **`DeliverySettlementBatch`** até `transfer_done` + **`asaas_transfer_id`** opcional.
- **Compose**, **cron** (`compose-scheduled` + **`GIRO_CRON_SECRET`**), **`execute-transfer`** opcional com **`ASAAS_ENABLE_PAYOUTS=true`**.

### 6.7 Fase 3 nesta sprint (perfis de repasse + initiate em corrida)

- Migração **`payout_bank_account_json`** (`npm run db:migrate:payout-bank-profile`).
- Perfis **`GET/PATCH`** `/api/partners/me/payout-bank-profile` e `/api/users/me/payout-bank-profile`.
- **`execute-transfer`** sem `bankAccount` no body → usa perfil gravado conforme **`beneficiary_type`** do lote.
- **`postpaid_pix` / `authorize_capture`**: `initiate` permitido também com pedido em corrida (**`accepted`**, **`arrivedAtStore`**, **`inTransit`**, **`arrivedAtDestination`**, **`inProgress`**).

- **Reconciliação:** `POST /api/settlement/reconcile/payments`, `POST /api/settlement/reconcile/transfers` e **`reconcile-scheduled`** (cron, `GIRO_CRON_SECRET`).

### 6.8 Fase 4 — operação admin + defaults por modo

- **Painel** `giro-certo-next`: rota **`/dashboard/settlements`** — resumo do livro, compor lotes, reconciliar cobranças/transferências, listar lotes e **Repassar** (usa `payout_bank_account_json` do beneficiário).
- **`resolveInitiateBillingType`**: sem `billingType` no body → `PIX` em `postpaid_pix`, `CREDIT_CARD` em `authorize_capture`, `UNDEFINED` em `prepaid`.
- **Cron Render** (sugestão): além de `compose-scheduled`, agendar `POST /api/settlement/reconcile-scheduled` (ex.: a cada 15–30 min) com o mesmo `x-giro-cron-secret`.

### 6.9 Escopo fechado — pagamentos entrega (MVP)

As fases **1–4** abaixo cobrem o MVP de pagamentos/repasses para **serviço de entrega**. Itens fora deste escopo ficam no produto geral (disputas §5.7, extrato próprio, captura Asaas em duas etapas).

| Fase | Entregue |
|------|----------|
| 1 | Cobrança Asaas, webhook, `DeliveryPayment`, modos na loja, Flutter checkout pré-pago |
| 2 | Livro `DeliverySettlementLedger`, lotes, compose/cron, `execute-transfer` |
| 3 | `payout_bank_account_json`, perfis GET/PATCH, `initiate` em corrida (pós-pago) |
| 4 | Reconciliação API + cron, painel `/dashboard/settlements`, defaults `billingType` |

### 6.10 Checklist go-live (pagamentos entrega)

**Base de dados (ordem):**

1. `npm run db:migrate:delivery-payment`
2. `npm run db:migrate:delivery-settlement-ledger`
3. `npm run db:migrate:delivery-settlement-batches`
4. `npm run db:migrate:payout-bank-profile`

**Variáveis (API):** `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_ENV`, `GIRO_PLATFORM_FEE_*`, `GIRO_SETTLEMENT_FEE_*`, `GIRO_CRON_SECRET`; opcional `ASAAS_ENABLE_PAYOUTS=true` quando for repassar; `ASAAS_FALLBACK_PAYER_CPF` em sandbox.

**Asaas:** webhook `POST {API}/api/webhooks/asaas` com cabeçalho `asaas-access-token`.

**Cron Render (mesmo `GIRO_CRON_SECRET`, header `x-giro-cron-secret`):**

| Job | Método | Sugestão |
|-----|--------|----------|
| Compor lotes | `POST /api/settlement/batches/compose-scheduled` | 1×/dia (ex. 03:00) |
| Reconciliar | `POST /api/settlement/reconcile-scheduled` body `{}` | a cada 15–30 min |

**Smoke test:** loja `prepaid` → `initiate` → webhook `paid` → despacho → rider aceita → admin compõe lote → repasse (sandbox) com perfil bancário preenchido no app.

**Apps:** lojista em Configurações → Pagamentos (modo + conta); rider → conta de repasse; admin → Repasses Asaas.

### 6.11 Backlog pós-MVP pagamentos

- Extrato financeiro próprio vs Asaas · disputas/reembolsos operacionais (§5.7).
- Captura tardia Asaas (authorize + capture explícitos) além do checkout com cartão.

---

## 7. Referências internas

| Documento | Conteúdo |
|-----------|----------|
| [`giro-certo-flutter/PANORAMA_GERAL.md`](../../giro-certo-flutter/PANORAMA_GERAL.md) | Tabelas, endpoints resumidos, visão mobile |
| [`README_ROLES.md`](../README_ROLES.md) | ADMIN / MODERATOR / USER |
| [`PLAYBOOK_OPERACIONAL_GIRO_CERTO.md`](../PLAYBOOK_OPERACIONAL_GIRO_CERTO.md) | Operações |
| [`giro-certo-next/README.md`](../../giro-certo-next/README.md) | Painel admin |

---

*Este ficheiro deve ser atualizado quando a Fase 1 alterar schema ou regras de negócio.*
