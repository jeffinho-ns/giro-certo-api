# Go-Live Giro Certo — Plano de 2 semanas

> Prazo: **14 dias**. Público prioritário: **app (riders + lojistas) + admin**.  
> Cliente final: **só pela vitrine web** (`giro-certo-next`).  
> **Package ID / Firebase / assinatura de loja: só no final** — até lá, testes em telefones de casa (debug).

---

## Visão do lançamento

| Público | Canal | O que precisa no go-live |
|---------|-------|---------------------------|
| Motociclista social / comunidade | App Flutter | Feed, garagem, manutenção, manuais, comunidades |
| Entregador (moto e bike) | App Flutter | Oferta → aceite → navegação → PIN → payout |
| Lojista | App + Portal Next | Pedidos, dispatch, cardápio, vitrine, horário |
| Admin | Portal `/dashboard` | Aprovar delivery, moderar, torre, financeiro |
| Cliente final | Web `/loja/[slug]` + `/pedido/[token]` | Catálogo, PIX, mapa ao vivo, status |

---

## Semana 1 — Fundação

### Cliente na vitrine
- [x] Socket `tracking:join-by-token`
- [x] Sync `StoreOrder` ↔ `DeliveryOrder`
- [x] Mapa Leaflet em `/pedido/[token]`
- [x] Webhook Asaas fail-closed + validação de env no startup
- [x] Remover senha do `localStorage` no login Next
- [x] Loja fechada bloqueia checkout (`operatingHours`)
- [x] Poll PIX + “Acompanhar pedido”
- [x] Metadata SEO “Giro Certo”

### Admin / lojista
- [x] Checklist admin (`docs/ADMIN_GO_LIVE.md` no Next)
- [x] Configurações: horário de funcionamento (`/minha-loja/configuracoes`)
- [x] Pedidos novos mais visíveis + mensagem de estorno na recusa
- [x] Link da vitrine com copiar no portal

### App (sem release de loja)
- [x] `API_URL` via `--dart-define`
- [x] Handlers globais de erro
- [x] Checklist release documentado (usar só no final)
- [x] Social: manuais, manutenção, comunidades/eventos
- [x] Retry itens do pedido no lojista
- [x] “Ver vitrine” no menu do lojista (copia link)

### Infra leve
- [x] Health check com ping no banco (`GET /health`)
- [x] Smoke test em casa (`docs/SMOKE_TEST_CASA.md`)

---

## Semana 2 — Testes em casa + polimento

### Testes controlados (agora)
- [ ] Seguir `SMOKE_TEST_CASA.md` nos telefones
- [ ] Admin: criar lojista → aprovar delivery → torre
- [ ] Loop completo: vitrine → PIX → aceite → rider → mapa

### Ainda opcional antes do “final”
- [ ] Estorno automático Asaas (hoje é mensagem + manual)
- [ ] Liquidação automática do `StoreOrder` (piloto pode ser manual)
- [ ] Página de configurações também no app Flutter

### Final do projeto (só quando for publicar nas lojas)
- [ ] Package ID real (não `com.example.*`)
- [ ] Keystore Android + provisioning iOS
- [ ] Firebase/FCM com package final
- [ ] APNs / background modes
- [ ] Crashlytics/Sentry
- [ ] TestFlight / internal track Play

---

## Papel do Admin

1. Cadastra lojistas  
2. Aprova delivery (moto/bike)  
3. Modera social  
4. Torre de controle  
5. Financeiro / settlements  

Ver `giro-certo-next/docs/ADMIN_GO_LIVE.md`.

---

## Critério de sucesso (teste em casa)

- [ ] Rider social: posta, garagem, manual
- [ ] Entregador: online → oferta → entrega com PIN
- [ ] Lojista: horário, produtos, aceita pedido da vitrine
- [ ] Admin: aprova delivery, vê torre
- [ ] Cliente no celular: compra, PIX, mapa do rider
