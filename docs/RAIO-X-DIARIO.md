# Raio-X Diário — Giro Certo (05/07/2026)

## Feito

### Vitrine web (giro-certo-next)
- Autocomplete de endereço no checkout (`AddressAutocompleteField` + rotas públicas da API)
- Grade de horário de funcionamento quando a loja está fechada
- Mapa ao vivo em `/pedido/[token]` (sessão anterior)
- Bloqueio de pedido com loja fechada, poll PIX acelerado, feedback de pagamento
- Portal lojista: produtos, promoções, pedidos, cupons, avaliações, personalização, configurações
- Remoção de senha do `localStorage` no login

### API (giro-certo-api)
- Geocodificação automática do endereço ao criar pedido (quando o cliente não envia GPS)
- Rotas públicas `GET /api/store/public/places/autocomplete` e `.../details`
- Estorno automático Asaas ao recusar pedido já pago (`asaasRefundPayment`)
- Socket `tracking:join-by-token` + sync `StoreOrder` ↔ `DeliveryOrder`
- Webhook Asaas fail-closed em produção + validação de env no startup
- `PUT /partners/me` para lojista (horário, telefone, raio, preparo)
- Health check com ping no PostgreSQL
- Loja virtual completa: catálogo, cupons, avaliações, pagamento PIX, ponte para entrega

### App Flutter (giro-certo-flutter)
- Tela **Configurações da loja** (horário, telefone, preparo, raio) via `PUT /partners/me`
- Gestão de produtos, promoções e personalização da vitrine com upload de imagem
- Link “Ver vitrine” no menu do lojista
- `API_URL` via `--dart-define`, handlers globais de erro
- Social: manuais, manutenção, comunidades (polish anterior)
- Retry de itens do pedido na home do lojista

### Documentação
- `GO_LIVE_2_SEMANAS.md`, `SMOKE_TEST_CASA.md`, `ADMIN_GO_LIVE.md`, `RELEASE_CHECKLIST.md`

---

## Status

**~88%** do go-live funcional.

| Área | % estimado |
|------|------------|
| API core + loja virtual + entrega | 92% |
| Vitrine web (cliente final) | 90% |
| Portal lojista/admin (Next) | 88% |
| App motociclista/lojista (Flutter) | 85% |
| Infra produção (Render, env, domínios) | 70% |
| Publicação nas lojas (package, Firebase, assinatura) | 0% (adiado de propósito) |

O código das features planejadas está praticamente completo. O que falta é sobretudo **teste real em casa**, **configuração de produção** e **publicação nas lojas**.

---

## Pendências (para 100%)

### Bloqueadores de go-live operacional
1. **Smoke test em casa** (`docs/SMOKE_TEST_CASA.md`) nos telefones — nenhum fluxo foi validado end-to-end pelo time ainda
2. **Variáveis de produção** no Render: `JWT_SECRET`, `DATABASE_URL`, `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `GOOGLE_MAPS_SERVER_KEY` (opcional mas melhora rotas/geocode)
3. **Domínio da vitrine** (`NEXT_PUBLIC_API_URL` no Next apontando para API de produção)
4. **Admin**: cadastrar lojista real, aprovar entregadores, validar torre de controle

### Funcional (opcional / pós-piloto)
- Liquidação automática de `StoreOrder` (repasse ao lojista) — hoje manual/piloto
- Estorno: depende de sandbox/produção Asaas com chave válida; testar recusa após PIX pago
- Notificações push (FCM) para rider/lojista — requer Firebase com package final
- Crashlytics/Sentry no app

### Publicação nas lojas (final do projeto, conforme combinado)
- Package ID definitivo (trocar `com.example.*`)
- Keystore Android + provisioning iOS
- Firebase/FCM + APNs com package final
- TestFlight / faixa interna Play Store
- `docs/RELEASE_CHECKLIST.md` no Flutter

### Testes manuais prioritários hoje
1. Cliente: `/loja/[slug]` → autocomplete endereço → PIX → `/pedido/[token]` com mapa
2. Lojista: aceitar pedido → rider recebe oferta → PIN → conclusão
3. Lojista: recusar pedido pago → confirmar estorno no Asaas
4. App: configurar horário → vitrine mostra “Fechada” fora do horário
5. Admin: aprovar delivery, moderar post social

---

*Gerado automaticamente ao fim da sessão autônoma de 05/07/2026.*
