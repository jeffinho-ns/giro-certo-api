# Plano de Arquitetura — Loja Virtual (Giro Certo)

> Documento mestre. Cópia idêntica nos três repositórios (`giro-certo-api`, `giro-certo-next`, `giro-certo-flutter`).
> Objetivo: permitir continuar o desenvolvimento em qualquer computador seguindo um plano único e bem arquitetado.
>
> **Status:** Planejamento aprovado. Nenhuma implementação iniciada.
> **Última atualização:** 2026-06-21

---

## 1. Objetivo da feature

Transformar o serviço (hoje fechado: lojista ↔ motoboy, todos autenticados) em um serviço que também atende o **público final**, oferecendo a cada lojista uma **loja virtual (catálogo)** personalizada.

Fluxo desejado:

1. O cliente final entra na loja virtual do lojista (vitrine pública).
2. Monta o pedido (catálogo com variações/adicionais) e paga.
3. O lojista aceita o pedido.
4. A partir do aceite, **segue exatamente o fluxo de entrega que já existe** (solicitar motoboy, oferta, aceite, retirada, entrega, rastreamento).
5. O lojista gerencia tudo tanto pelo **app Flutter** quanto pelo **portal web** (paridade).
6. O cliente acompanha o motoboy em tempo real.

### Princípio condutor

> **Reaproveitar o motor existente.** Pagamento (Asaas), despacho, oferta a motoboys e rastreamento já estão prontos. A loja virtual é uma **camada nova na frente** que, no momento certo, gera o mesmo `DeliveryOrder` de hoje e injeta no pipeline atual. Mínima alteração no núcleo.

---

## 2. Decisões já tomadas

| Tema | Decisão |
|---|---|
| Identidade do cliente | **Visitante (sem login)**: nome + telefone + endereço no checkout; acompanha por link com token |
| Plataforma da vitrine pública | Dentro do **`giro-certo-next`** (rotas públicas) |
| Onde o lojista gerencia | **Portal web no `giro-certo-next`** primeiro; app Flutter apenas acompanha/aceita pedidos |
| Tipo de catálogo | **Com variações/adicionais** (tamanho, sabor, opcionais) — estilo cardápio de delivery |
| Cadastro do lojista | **NÃO muda.** Reaproveita o usuário/loja já criados pelo admin |

---

## 3. Contexto atual (resumo da arquitetura)

### giro-certo-api (backend)
- Node + TypeScript, **Express 5**, **PostgreSQL via `pg` puro (sem ORM)**. Schema em `scripts/migrate*.sql`.
- **Socket.IO** para realtime. **JWT** + `bcryptjs` para auth. **Asaas** para pagamento.
- Entidades-chave: `User` (todos os atores humanos), `Partner` (a loja), `DeliveryOrder` (entrega), `DeliveryPayment` (cobrança do cliente), `Wallet`.
- **Não existe** nenhuma entidade de produto/catálogo/carrinho. `DeliveryOrder` só tem `value` agregado + `notes`.
- Tipos em `src/types/index.ts`. Padrão por feature: migração SQL + runner em `scripts/` + service + controller + route.

### giro-certo-next (web)
- **Next.js 16 (App Router)** + React 19, **shadcn/Radix + Tailwind v4**, **TanStack Query**, `apiClient` (fetch) em `lib/api.ts`.
- Hoje é **somente painel admin/moderador** sob `/dashboard` (gate client-side via `localStorage`; `middleware.ts` não bloqueia no servidor).
- `ProtectedRoute` só conhece `requireAdmin`/`requireModerator`.

### giro-certo-flutter (app)
- Flutter + **provider**. App multi-perfil (motoboy, lojista, social).
- Fluxo de entrega completo: `partner_home_screen.dart` (lojista) e `delivery_screen.dart` + Mapbox (motoboy).
- `Partner` existe; **produtos/catálogo não existem**. `ApiService` em `lib/services/api_service.dart`.

### Sobre o cadastro do lojista (confirmado em código)
`partner.service.ts → createPartner` (rota `POST /partners`, **só admin**) cria, numa transação: a loja (`Partner`), o usuário do lojista (`User` com `partnerId`, senha padrão `@123mudar`) e a `Wallet`. **A loja virtual reaproveita esse usuário; nada muda no cadastro.**

---

## 4. Princípios de arquitetura e segurança

### Princípio nº 1 (o mais importante)
> A proteção de rota no Next é **apenas UX** (gate client-side). **A fronteira de segurança real é a `giro-certo-api`.** Toda autorização ("quem pode ver/fazer o quê") tem de ser imposta no backend. Isso vale dobrado agora que há público anônimo.

### Demais princípios
- **Nunca confiar em valores vindos do cliente.** Preço/total recalculados no servidor a partir do banco (snapshot de preço + variações).
- **Pedido só vira entrega após pagamento confirmado pelo webhook do Asaas** — nunca pela resposta do cliente.
- **Endpoints públicos devolvem DTO reduzido** — nunca o objeto `Partner` cru (que tem CNPJ, conta bancária, e-mail, comissões).
- **Isolamento por loja**: lojista só acessa a própria loja (`partnerId`), reaproveitando o padrão de guard já existente em `delivery.controller.ts`.
- **Separação total de papéis**: lojista nunca acessa o `/dashboard` da plataforma; admin/moderador é outra audiência.

---

## 5. As três áreas (no mesmo giro-certo-next)

```
app/
  (public)/                      ← SEM login, tema "consumidor"
    loja/[slug]/                 ← vitrine: catálogo + banners
    loja/[slug]/checkout/        ← carrinho → dados do cliente → pagamento
    pedido/[token]/              ← acompanhamento do motoboy (por token)

  (lojista)/                     ← login do LOJISTA (role USER + partnerId)
    minha-loja/
      produtos/                  ← CRUD de produtos + variações
      cardapio/                  ← categorias/seções
      promocoes/  banners/       ← campanhas
      pedidos/                   ← aceitar / acompanhar / despachar
      configuracoes/             ← horário, raio, dados de pagamento

  dashboard/                     ← JÁ EXISTE: plataforma (admin/moderador). INTOCADO.
```

| Área | Autenticação | Quem entra |
|---|---|---|
| `(public)` | Nenhuma | Qualquer cliente final |
| `(lojista)` | Login obrigatório | `UserType.LOJISTA` (= `role USER` + `partnerId`) |
| `dashboard` | Login obrigatório | `MODERATOR` / `ADMIN` |

**Ação necessária no front:** estender `ProtectedRoute` com um critério `requireLojista` (tem `partnerId`), e garantir que lojista e admin não cruzem de área.

### Espelho na API (a camada que realmente protege)
```
/api/store/public/*     ← SEM auth. Leitura de catálogo + criar pedido + status por token. Rate-limited.
/api/store/manage/*     ← Auth + exige partnerId. Escopado à PRÓPRIA loja.
/api/... (admin atual)  ← requireAdmin/requireModerator, como hoje.
```

---

## 6. Modelo de dados novo (giro-certo-api)

Seguir o padrão do projeto: migração `scripts/migrate-loja-virtual.sql` + runner em `scripts/` + tipos em `src/types/index.ts`. Sem ORM.

| Tabela | Campos-chave | Observação |
|---|---|---|
| `ProductCategory` | `id`, `partnerId`, `name`, `sortOrder`, `active` | seções da vitrine ("Lanches", "Bebidas") |
| `Product` | `id`, `partnerId`, `categoryId`, `name`, `description`, `basePrice`, `photoUrl`, `active` | item base |
| `ProductOptionGroup` | `id`, `productId`, `name`, `min`, `max`, `required` | ex.: "Tamanho" (1 obrigatório), "Adicionais" (0–N) |
| `ProductOption` | `id`, `optionGroupId`, `name`, `priceDelta` | ex.: "Grande +R$5", "Bacon +R$3" |
| `StoreBanner` / `Promotion` | `id`, `partnerId`, `imageUrl`, `startsAt`, `endsAt`, `discount` | campanhas e banners |
| `StoreCustomer` (leve) | `id`, `name`, `phone`, `address` | sem login; só reaproveitar dados |
| `StoreOrder` | `id`, `partnerId`, dados do cliente (snapshot), `subtotal`, `deliveryFee`, `total`, `status`, `paymentId`, `deliveryOrderId`, `trackingToken` | o pedido de compra |
| `StoreOrderItem` | `id`, `storeOrderId`, `productId`, `name`/`price` (snapshot), `quantity`, `selectedOptions` (JSON snapshot) | itens com variações escolhidas |

**Alteração mínima em entidade existente:** adicionar `storeOrderId` (opcional) em `DeliveryOrder`, para ligar a logística ao pedido de compra e levar os itens ao app/portal do lojista.

### Status do StoreOrder (sugestão)
`awaiting_payment → paid → accepted_by_store → dispatched → (segue DeliveryStatus) → completed` (+ `cancelled` / `rejected`).

---

## 7. Fluxo end-to-end

```
1. Cliente abre /loja/[slug]            → vê banners + catálogo com variações
2. Monta carrinho (escolhe adicionais)  → checkout (nome, telefone, endereço)
3. API cota a entrega (getDeliveryQuote, JÁ EXISTE) → total = itens + taxa
4. Cliente paga (Asaas/PIX, JÁ EXISTE)  → webhook marca StoreOrder = "paid"
5. Lojista recebe o pedido (portal web + app) → ACEITA
6. No aceite: API gera DeliveryOrder a partir do StoreOrder + chama dispatchOrder() (JÁ EXISTE)
7. >>> Pipeline atual: oferta → motoboy aceita → retirada → trânsito → entrega
8. Cliente acompanha o motoboy via trackingToken (mesma sala de tracking do Socket.IO)
```

---

## 8. Mudanças por repositório

### giro-certo-api (maior parte do trabalho)
- [ ] Migração + tipos das novas entidades (Seção 6).
- [ ] `storeOrderId` opcional em `DeliveryOrder` (migração + tipo).
- [ ] CRUD de catálogo/categorias/variações/banners — namespace `/api/store/manage/*`, escopado por `partnerId`.
- [ ] Namespace público `/api/store/public/*`: ver loja+catálogo por slug (DTO reduzido), criar `StoreOrder`, iniciar pagamento, consultar status por token.
- [ ] Ponte `StoreOrder → DeliveryOrder` no aceite do lojista (reusar `dispatchOrder`).
- [ ] Estender webhook Asaas (`POST /api/webhooks/asaas`) para marcar `StoreOrder` como pago.
- [ ] Permitir cliente anônimo entrar **só** na sala de tracking do próprio pedido via `trackingToken`.
- [ ] **Rate limiting** nos endpoints públicos (sobretudo `quote` e criação de pedido).
- [ ] **CORS** restrito às origens conhecidas.

### giro-certo-next
- [ ] Grupo `app/(public)/`: vitrine `loja/[slug]`, checkout, acompanhamento `pedido/[token]` (mapa com Leaflet, já usado).
  - Idealmente Server Components para SEO da vitrine.
- [ ] Grupo `app/(lojista)/minha-loja/`: produtos, cardápio/variações, promoções/banners, **pedidos** (aceitar/acompanhar/despachar), configurações.
- [ ] Estender `ProtectedRoute` com `requireLojista` (tem `partnerId`); impedir cruzamento lojista ↔ admin.
- [ ] Reusar `apiClient` + React Query + design system `components/ui`.
- [ ] `dashboard` permanece **intocado**.

### giro-certo-flutter (mexe pouco)
- [ ] `PartnerHomeScreen` passa a exibir os **itens do pedido** quando vier da loja virtual (buscar via `storeOrderId`).
- [ ] Aceite/despacho permanecem idênticos ao fluxo atual.
- [ ] (Fase 3, opcional) edição de produtos/promoções pelo app.

---

## 9. Checklist de segurança (abertura ao público)

- [ ] **Sem vazamento interno:** `GET /store/public/:slug` retorna DTO reduzido (sem CNPJ, conta bancária, e-mail do lojista, comissões, pedidos de terceiros, dados de motoboy).
- [ ] **Preço no servidor:** total recalculado a partir do banco (base + variações). Cliente não envia preço.
- [ ] **Pagamento confiável:** webhook Asaas já valida `asaas-access-token`; despacho só após `paid` confirmado pelo webhook.
- [ ] **Tracking com privacidade:** token aleatório/não sequencial por pedido; localização do motoboy visível **apenas durante a entrega ativa**; nunca expor o feed de GPS de todos os motoboys.
- [ ] **Anti-abuso:** rate limiting em endpoints públicos; exigir pagamento antes de despachar (já mitiga pedidos falsos).
- [ ] **LGPD:** nome/telefone/endereço do cliente só visíveis ao lojista dono do pedido (e admin); definir retenção.
- [ ] **CORS:** liberar só origens conhecidas; nunca `*` com credenciais.
- [ ] **Upload:** validar tipo/tamanho das imagens de produto/banner; escopar ao `partnerId`.
- [ ] **Credenciais:** considerar **forçar troca da senha padrão** (`@123mudar`) no primeiro acesso do lojista ao portal (melhoria recomendada).

---

## 10. Faseamento (roadmap)

### Fase 1 — MVP (catálogo + pedido + entrega)
- API: entidades de catálogo (produto + variações), `StoreOrder`/itens, `storeOrderId` em `DeliveryOrder`, namespace público, ponte para `dispatchOrder`, webhook estendido, rate limiting básico.
- Next: portal do lojista para cadastrar produtos; vitrine pública (catálogo + carrinho + checkout + pagamento); acompanhamento por link.
- Flutter: `PartnerHomeScreen` mostrando itens do pedido.

### Fase 2 — Experiência
- Banners, campanhas e promoções.
- Loja personalizada e "bonita" por lojista.
- Aba de Pedidos completa no portal, espelhando o app.

### Fase 3 — Polimento
- Notificações ao cliente; avaliação da loja; cupons.
- Edição de produtos/promoções pelo app Flutter.
- (Opcional) identidade do cliente com login e histórico.

---

## 11. Pontos de atenção / dívidas conhecidas

- A API **não tem ORM**: toda entidade nova segue o padrão SQL manual + runner. Cuidado com migrações idempotentes.
- O gate de auth do Next é client-side; **não é segurança** — sempre validar na API.
- `google-services.json` e artefatos de build (`android/.gradle/...`) **não devem ser versionados** com segredos. Revisar `.gitignore` do `giro-certo-flutter` antes de commits amplos.
- Há dependências residuais de `fastify`/`ws` na API que não são usadas (o app real é Express + Socket.IO) — não confundir ao implementar.

---

## 12. Como retomar em outro computador

1. `git clone` (ou `git pull`) dos três repositórios do GitHub `jeffinho-ns`.
2. Ler este documento (presente na raiz dos três repositórios).
3. Começar pela **Fase 1 na `giro-certo-api`** (modelo de dados é a base de tudo).
4. Seguir os checklists das Seções 8, 9 e 10.
