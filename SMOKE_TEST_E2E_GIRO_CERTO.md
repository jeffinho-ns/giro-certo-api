# Smoke Test E2E - Giro Certo

## Objetivo
Validar o fluxo real ponta a ponta com 3 perfis simultaneos:
- Lojista
- Entregador
- Admin (Control Tower)

## Setup Minimo
- 3 dispositivos/sessoes logadas (ou 3 navegadores + 1 app).
- Ambiente com API e socket ativos.
- 1 pedido real com endereco valido (Places + rota).
- Simulacao de rede ruim no entregador:
  - Latencia: 300-800ms
  - Perda de pacotes: 5-15%
  - Interrupcao de 15-30s (modo aviao) com reconexao

## Fluxo 1 - Criacao e Aceite
- [ ] Lojista cria pedido com endereco real e recebe `internalCode`.
- [ ] Pedido aparece para entregador sem atraso relevante.
- [ ] Entregador aceita corrida.
- [ ] Lojista passa a ver nome, email, telefone e foto do entregador em tempo real.
- [ ] Admin visualiza corrida ativa no painel.
- [ ] Retry de aceite (mesmo `x-idempotency-key`) nao duplica evento nem altera rider.

## Fluxo 2 - Loja e Handshake de Retirada
- [ ] Entregador marca `arrivedAtStore`.
- [ ] API/notificacoes refletem status em lojista e admin.
- [ ] Entregador tenta iniciar `inTransit` com codigo errado e recebe erro de validacao.
- [ ] Entregador informa codigo correto (`GC-XXXXXXXX`) e transicao ocorre.
- [ ] Retry de `inTransit` (rede ruim) nao duplica transicao/evento.

## Fluxo 3 - Navegacao, Reconexao e Finalizacao
- [ ] Localizacao do entregador atualiza de forma fluida (1-2s em navegacao).
- [ ] Durante perda de rede, app nao quebra e retoma socket automaticamente.
- [ ] Ao reconectar, status e trilha voltam sincronizados.
- [ ] Entregador finaliza entrega.
- [ ] Retry de finalizacao nao gera credito duplicado nem eventos repetidos.

## Fluxo 4 - Pos Entrega e Auditoria
- [ ] Lojista/admin visualizam historico de rota da corrida concluida.
- [ ] Status final consistente em todos os clientes.
- [ ] Metricas SLA disponiveis em `GET /api/dashboard/delivery-sla`.

## Criterio de Aprovacao
- Zero duplicidade de aceite/status critico.
- Handshake de retirada bloqueando codigo invalido.
- Reconexao sem quebra de sessao no fluxo ativo.
- Visibilidade completa para admin/lojista.
