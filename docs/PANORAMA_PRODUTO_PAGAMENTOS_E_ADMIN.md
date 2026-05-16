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

**Webhook:** configurar URL pública no painel Asaas apontando para `POST .../api/webhooks/asaas`.

### 6.4 Regras atuais da cobrança “initiate”

- Pedido em **`awaiting_dispatch`** ou **`pending` sem rider aceito**.  
- **Snapshot de valores:** total ao cliente = `value + deliveryFee`; taxas fixas por env (`GIRO_PLATFORM_FEE_STORE_FIXED`, `GIRO_PLATFORM_FEE_RIDER_PER_ORDER`).  
- Telefone do destinatário obrigatório (10+ dígitos) para criar cliente Asaas.  
- **Modos `postpaid_pix` e `authorize_capture`:** política já gravada na loja; fluxo operacional completo virá nas próximas iterações.

### 6.5 Ainda não implementado (próximas fases)

- Repasses agendados (dia/semana/mês) e taxas de liquidação.  
- Bloqueio rigoroso do fluxo logístico até `paid` conforme política da loja.  
- Checkout no app Flutter / deep link dedicado.  
- Job de reconciliação automática.

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
