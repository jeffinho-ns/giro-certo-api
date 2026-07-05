# Smoke test em casa (telefones controlados)

> **Não precisa** de package ID, Firebase de produção nem assinatura de loja.  
> Use builds de **debug** no Flutter e o site no **navegador do celular**.

## Antes de começar

1. API no ar (`/health` deve retornar `"db": "up"`).
2. Next no ar (portal + vitrine).
3. App Flutter instalado via cabo (`flutter run`) nos aparelhos de teste.
4. Contas de teste:
   - **Admin** (dashboard)
   - **Lojista** (com `partnerId` e `slug`)
   - **Entregador** (moto ou bike, aprovado)
   - **Piloto social** (opcional)

### Link da vitrine

No portal do lojista (sidebar): **Copiar** o caminho `/loja/<slug>`.  
No celular, abra `https://SEU-NEXT/loja/<slug>` (ou o IP da máquina na rede local se estiver em `localhost`).

No app do lojista: menu lateral → **Ver vitrine** (copia o caminho se `WEB_URL` não estiver definido).

Para abrir direto no browser a partir do app:
```bash
flutter run --dart-define=WEB_URL=https://seu-next.com
```

---

## 1) Admin (navegador)

- [ ] Login em `/login`
- [ ] Dashboard carrega
- [ ] Criar ou abrir um lojista em `/dashboard/partners`
- [ ] Aprovar um cadastro delivery em `/dashboard/delivery-registrations`
- [ ] Torre de controle: ver riders online (se houver)

## 2) Lojista — portal (navegador no celular ou PC)

- [ ] Login → cai em `/minha-loja/pedidos`
- [ ] **Configurações**: definir horário (ex.: aberto agora) e salvar
- [ ] **Produtos**: criar um produto com preço e foto
- [ ] **Copiar** link da vitrine e abrir no celular
- [ ] Pedido pago aparece em **Novos** (poll 15s)
- [ ] **Aceitar** pedido → vira entrega

## 3) Lojista — app Flutter

- [ ] Login como lojista
- [ ] Ver pedidos / criar corrida manual
- [ ] **Ver vitrine** no menu (copia link)
- [ ] Meus Produtos / Promoções / Personalizar abrem

## 4) Entregador (app)

- [ ] Login, ficar **online**
- [ ] Receber oferta (se FCM local funcionar; senão, poll/realtime)
- [ ] Aceitar → navegação Mapbox (precisa token Mapbox local)
- [ ] Código da loja → PIN do cliente → concluir

## 5) Piloto social (app)

- [ ] Feed, criar post
- [ ] Garagem + banner de manutenção se houver alerta
- [ ] Manual (guia iniciantes)
- [ ] Atalhos Comunidades / Eventos

## 6) Cliente final (navegador do celular)

- [ ] Abrir `/loja/<slug>`
- [ ] Se loja **fechada** (horário), não consegue pedir
- [ ] Se **aberta**: montar carrinho, checkout, PIX
- [ ] Após pagar (ou simular webhook em sandbox): status atualiza
- [ ] `/pedido/<token>`: timeline + **mapa** do entregador quando em rota

## Problemas comuns em casa

| Sintoma | O que checar |
|---------|----------------|
| Vitrine “fechada” o tempo todo | Horário em Configurações (fuso SP) ou deixe sem horário = sempre aberta se não bloqueada |
| Mapa sem rider | Entrega precisa estar ativa e rider enviando GPS |
| API 503 no health | `DATABASE_URL` / Postgres |
| Push não chega | Normal em debug sem APNs/Firebase de prod — use realtime/poll |
| Mapbox em branco | `local.properties` / `MapboxKeys.xcconfig` com token |

## Package / Firebase / assinatura

**Deixado para o final do projeto.** Enquanto isso, só debug nos seus telefones.
