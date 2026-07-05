# Go-Live Giro Certo — Plano de 2 semanas

> Prazo: **14 dias**. Público prioritário: **app (riders + lojistas) + admin**.  
> Cliente final: **só pela vitrine web** (`giro-certo-next`), mas com experiência completa desde o dia 1 (mapa, status, pagamento).  
> Agentes ECC: **somente** release do app e fluxo entregador/lojista.

---

## Visão do lançamento

| Público | Canal | O que precisa no go-live |
|---------|-------|---------------------------|
| Motociclista social / comunidade | App Flutter | Feed, garagem, manutenção, manuais, comunidades |
| Entregador (moto e bike) | App Flutter | Oferta → aceite → navegação → PIN → payout |
| Lojista | App + Portal Next | Pedidos, dispatch, cardápio, vitrine |
| Admin | Portal `/dashboard` | Aprovar delivery, moderar, torre, financeiro |
| Cliente final | Web `/loja/[slug]` + `/pedido/[token]` | Catálogo, PIX, mapa ao vivo, status |

---

## Semana 1 — Fundação (dias 1–7)

### Dia 1–2 — Cliente na vitrine (já iniciado no código)
- [x] Plano documentado
- [ ] Socket `tracking:join-by-token` (cliente anônimo)
- [ ] Sync `StoreOrder` ↔ status da `DeliveryOrder`
- [ ] Mapa Leaflet em `/pedido/[token]`
- [ ] Webhook Asaas fail-closed + validação de env no startup
- [ ] Remover senha do `localStorage` no login Next

### Dia 3 — Admin operacional
- [ ] Checklist admin no dashboard (ou doc operacional)
- [ ] Confirmar fluxos: aprovar cadastro delivery, moderação, torre de controle, settlements
- [ ] Smoke: admin cria lojista → lojista publica vitrine → pedido → rider entrega

### Dia 4–5 — Release do app (infra)
- [ ] `API_URL` via `--dart-define` (sem hardcode único)
- [ ] Handlers globais de erro (crash visibility)
- [ ] Checklist release: bundle ID, keystore, Firebase package, Mapbox, APNs
- [ ] **Ação humana (você):** definir package final (`br.com.girocerto` ou similar), gerar keystore, recriar Firebase

### Dia 6–7 — Social / comunidade
- [ ] Manuais mais úteis (seções claras, dicas para iniciantes)
- [ ] Manutenção: feedback visual de alertas críticos
- [ ] QA social: post, story, follow, chat, garagem

**ECC nesta semana:** `ecc-flutter-reviewer` (release), `ecc-silent-failure-hunter` (delivery/lojista).

---

## Semana 2 — Polimento e go-live (dias 8–14)

### Dia 8–9 — Fluxo entregador/lojista
- [ ] QA E2E device real: oferta FCM, Mapbox, códigos, PIN
- [ ] Lojista: pedido da vitrine com itens, aceite, dispatch
- [ ] Estorno manual documentado (recusa de pedido pago) + se der tempo, estorno automático

### Dia 10 — Vitrine cliente
- [ ] Polling “pagamento confirmado” pós-PIX
- [ ] Loja fechada bloqueia checkout (se `operatingHours` disponível)
- [ ] Metadata SEO da vitrine (não “Admin”)

### Dia 11–12 — Admin + financeiro
- [ ] Repasse: validar `DeliveryPayment` clássico em prod
- [ ] Documentar liquidação de pedidos da vitrine (manual no piloto se necessário)
- [ ] Health check com DB

### Dia 13 — Testes e smoke
- [ ] Checklist smoke completo (admin, rider, lojista, cliente web)
- [ ] Migrações loja virtual rodadas em prod

### Dia 14 — Go-live
- [ ] Deploy API + Next + build release app (TestFlight / internal track)
- [ ] Monitoramento (logs, webhook, crashes)
- [ ] Comunicação aos primeiros lojistas/riders

---

## Papel do Admin (crítico no início)

O admin é o **operador do ecossistema**:

1. Cadastra lojistas (`Partner` + usuário com senha inicial)
2. Aprova cadastros de delivery (moto/bike)
3. Modera conteúdo social (reports, denúncias)
4. Torre de controle (riders online, pedidos ativos)
5. Financeiro / settlements
6. Desbloqueia lojas inadimplentes

Sem admin bem operando, riders e lojistas não entram no ar com segurança.

---

## O que você precisa decidir/fazer manualmente (bloqueadores humanos)

1. **Package ID final** Android + iOS (ex.: `br.com.girocerto.app`)
2. **Keystore Android** + senhas (guardar fora do git)
3. **Apple Developer** team + provisioning + APNs
4. **Firebase** apps recriados com o package final
5. **Asaas produção**: `ASAAS_API_KEY`, `ASAAS_ENV=production`, `ASAAS_WEBHOOK_TOKEN`
6. **CORS_ORIGIN** com domínio real do Next
7. **JWT_SECRET** forte em produção

---

## Critério de sucesso no dia 14

- [ ] Rider social: abre app, posta, vê feed, garagem
- [ ] Entregador: fica online, recebe oferta, entrega com PIN
- [ ] Lojista: cria pedido ou recebe da vitrine, despacha
- [ ] Admin: aprova delivery, vê torre, não há pedido órfão sem dono
- [ ] Cliente web: compra na vitrine, paga PIX, vê status + mapa do rider
- [ ] App em internal/TestFlight (não precisa Play Store pública no dia 1)

---

## Ordem de implementação (esta sessão e seguintes)

1. API tracking anônimo + sync status + webhook + startup
2. Next mapa + segurança login
3. Flutter release basics
4. Social polish
5. Admin checklist
6. QA e go-live
