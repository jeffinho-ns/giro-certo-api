# AGENTS.md — Instruções para qualquer IA / agente

> Este repositório faz parte da iniciativa **Loja Virtual (Giro Certo)**, que abrange três repos:
> `giro-certo-api` (backend), `giro-certo-next` (web) e `giro-certo-flutter` (app).
>
> **ANTES de qualquer tarefa, leia o documento mestre [`PLANO_LOJA_VIRTUAL.md`](./PLANO_LOJA_VIRTUAL.md) na raiz.** Ele contém o objetivo, a arquitetura, o modelo de dados, o roadmap e os checklists de segurança. Siga-o como fonte de verdade.

## Como você (agente) deve agir

- **Sempre alerte o usuário** (em português) quando uma ação tocar em qualquer um dos pontos críticos abaixo, antes de executá-la.
- Não desvie do plano sem avisar. Se algo no plano conflitar com a realidade do código, **pare e alerte**.
- Trabalhe pela **Fase 1** primeiro (ver `PLANO_LOJA_VIRTUAL.md`, Seção 10).

## ALERTAS OBRIGATÓRIOS (sempre avisar antes de prosseguir)

1. **Segurança mora na API, não no front.** O gate de auth do `giro-certo-next` é client-side (UX). Toda autorização real ("quem pode ver/fazer o quê") tem de ser imposta na `giro-certo-api`. Alerte se alguém tentar confiar no front como barreira.
2. **Nunca commitar segredos nem lixo de build.** Especialmente `google-services.json`, `.env`, chaves Asaas/Firebase, e `android/.gradle/`, `android/local.properties`. Alerte e bloqueie antes de qualquer `git add`/commit amplo.
3. **Nunca confiar em preço/valor vindo do cliente.** Recalcule o total no servidor a partir do banco (preço base + variações).
4. **Pedido só vira entrega após pagamento confirmado pelo webhook do Asaas** — nunca pela resposta do cliente.
5. **Endpoints públicos devolvem DTO reduzido.** Nunca exponha o `Partner` cru (CNPJ, conta bancária, e-mail, comissões) nem dados de motoboy/terceiros.
6. **Rastreamento com privacidade.** Acompanhamento por token aleatório/não sequencial; localização do motoboy visível só durante a entrega ativa.
7. **Isolamento por loja.** Lojista só acessa a própria loja (`partnerId`) e nunca o `/dashboard` da plataforma (admin/moderador).

## Específico deste repo (giro-certo-api)

- **Sem ORM.** PostgreSQL via `pg` puro. Toda entidade nova segue o padrão: migração `scripts/migrate-*.sql` (idempotente) + runner em `scripts/` + tipo em `src/types/index.ts` + service/controller/route.
- App real é **Express + Socket.IO**. Ignore dependências residuais de `fastify`/`ws`.
- Pagamento via **Asaas**; webhook em `POST /api/webhooks/asaas` (valida `asaas-access-token`).
- **Rate limiting** e **CORS restrito** são obrigatórios nos endpoints públicos novos (`/api/store/public/*`).

## Git

- Só commitar/push quando o usuário pedir explicitamente.
- Nunca incluir segredos/artefatos de build. Em commits, adicione arquivos específicos, não `git add .` cego.
