# SSE (Server-Sent Events) — Giro Certo

Arquitetura **híbrida**: Socket.IO para bidirecional (GPS, chat, ofertas) + **SSE** para push servidor → cliente (status, notificações, pedidos).

## Endpoints (API)

| Rota | Auth | Canais |
|------|------|--------|
| `GET /api/realtime/stream?token=JWT` | JWT (query ou Bearer) | `user:{id}`, `store:{partnerId}`, `role:admin`, opcional `order:{id}` |
| `GET /api/realtime/store-order/:trackingToken/stream` | Público (token na URL) | `store-order:{token}`, `order:{deliveryId}` se ativo |

Headers de resposta: `text/event-stream`, heartbeat a cada 25s.

## Eventos (mesmos nomes do Socket.IO)

- `delivery:status:changed`, `delivery:update`
- `delivery:store_refresh` — lojista recarrega pedidos
- `store_order:update` — vitrine (PIX pago, status)
- `notification`, `delivery:new_order_offer`, `delivery:race:lost`
- `rider:location:update` — torre / tracking (throttled no servidor)

## Onde está integrado

### API
- `src/utils/sse-hub.ts` — hub de conexões
- `src/utils/socket-events.ts` — `ioEmit` / `ioEmitToRoom` também publicam no SSE
- Webhook Asaas loja → `store_order:update` + `delivery:store_refresh`

### Next.js
- `lib/sse.ts`, `hooks/use-sse-stream.ts`
- Lojista pedidos, vitrine PIX, `/pedido/[token]`, torre de controle
- Poll reduzido a 120s (fallback)

### Flutter
- `lib/services/sse_service.dart` — bridge no `RealtimeService`
- Poll lojista/delivery: 45s → 2min (SSE + socket cobrem o resto)

## Teste rápido

```bash
curl -N -H "Accept: text/event-stream" \
  "http://localhost:3001/api/realtime/store-order/SEU_TRACKING_TOKEN/stream"
```

Com JWT:

```bash
curl -N -H "Accept: text/event-stream" \
  "http://localhost:3001/api/realtime/stream?token=SEU_JWT"
```
