# Playbook Operacional - Giro Certo

> **Go-live entrega:** plano completo em [docs/GO_LIVE_ENTREGA.md](docs/GO_LIVE_ENTREGA.md) (migrações, env, smoke tests, rollout T0–T3).

## 1) Conflito de aceite
- Regra: primeiro aceite confirmado pela API vence.
- Sinal: erro `ORDER_ALREADY_ACCEPTED` para os demais entregadores.
- Acao:
  - Confirmar no painel qual rider ficou com a corrida.
  - Orientar rider que perdeu a seguir para nova corrida.
  - Se houver recorrencia alta, acompanhar metrica `acceptance_conflicts_total`.

## 2) Atraso na retirada/coleta
- Regra: apos `arrivedAtStore`, iniciar `inTransit` somente com codigo interno valido.
- Sinal: multiplas tentativas com `pickup_code_validation_failed_total`.
- Acao:
  - Loja deve confirmar verbalmente o codigo.
  - Entregador deve repetir o codigo no app.
  - Se persistir erro, cancelar corrida e abrir disputa operacional.

## 3) Item errado
- Regra: sem codigo correto, nao liberar retirada.
- Acao imediata:
  - Pausar saida do entregador.
  - Revalidar `internalCode` e nome do destinatario.
  - Registrar incidente no suporte com `orderId` e horario.

## 4) Cliente ausente
- Tentativas:
  - 3 contatos em ate 10 minutos.
  - Evidenciar tentativa no chat/ligacao.
- Desfecho:
  - Sem retorno: cancelar por ausencia do cliente.
  - Registrar motivo e etapa da corrida para auditoria.

## 5) Falha de rede/reconexao
- Regra: app deve reconectar de forma silenciosa.
- Acao:
  - Aguardar reconexao automatica.
  - Evitar multiplos toques no mesmo botao; retries sao idempotentes.
  - Se sem reconexao > 2 min, reiniciar app e validar status no painel admin.

## 6) Observabilidade minima diaria
- Monitorar:
  - `orders_created_total`
  - `orders_accepted_total`
  - `time_to_accept_seconds`
  - `store_to_client_seconds`
  - `orders_cancelled_total` (por etapa)
  - `geocoding_failures_total`
  - `route_failures_total`
  - `socket_failures_total`
- Endpoint: `GET /api/dashboard/delivery-sla?days=1`

## 7) Escalonamento
- Escalar para engenharia quando:
  - Falhas de socket/geocoding/rota crescem por 3 janelas consecutivas.
  - Tempo medio de aceite aumenta > 40% acima da baseline da semana.
  - Duplicidade de eventos criticos for detectada.
