# 🔍 Análise do Código Existente e Decisões de Implementação

## 📊 Resumo Executivo

Após análise completa do repositório, identifiquei que o sistema possui uma **base sólida** com:
- Arquitetura bem estruturada (Express + TypeScript + PostgreSQL)
- Sistema de autenticação e autorização funcionando
- Modelos de dados fundamentais (User, Partner, DeliveryOrder, Bike)
- Algoritmo de matching básico
- Frontend Next.js com estrutura moderna

As funcionalidades solicitadas são **incrementais e compatíveis** com o código existente, não requerendo refatorações grandes.

---

## 🎯 Decisões Arquiteturais Principais

### 1. **Tipo de Veículo (VehicleType)**

**Decisão:** Criar enum `VehicleType` e adicionar ao modelo `Bike` como campo opcional com default `MOTORCYCLE`.

**Raciocínio:**
- ✅ Mantém compatibilidade com dados existentes (todos os bikes atuais são motos)
- ✅ Permite evolução gradual (bicicletas podem ser adicionadas sem quebrar código)
- ✅ `plate` se torna nullable para suportar bicicletas
- ✅ Validação no backend garante que motos sempre tenham placa

**Impacto:** Baixo - apenas adiciona campo, não quebra funcionalidades existentes.

---

### 2. **Sistema de Documentos**

**Decisão:** Criar modelo separado `CourierDocument` ao invés de adicionar campos diretos no `User`.

**Raciocínio:**
- ✅ Um entregador pode ter múltiplos documentos (RG, CNH, Passaporte)
- ✅ Facilita gestão de status individual por documento
- ✅ Permite histórico de aprovações/rejeições
- ✅ Escalável para futuros tipos de documentos

**Estrutura:**
```
User (1) ──→ (N) CourierDocument
User (1) ──→ (N) VerificationSelfie
```

**Status do Documento:**
- `PENDING` → Aguardando upload
- `UPLOADED` → Upload feito, aguardando revisão admin
- `APPROVED` → Aprovado pelo admin
- `REJECTED` → Rejeitado (com motivo)
- `EXPIRED` → Expirado (se aplicável)

---

### 3. **Selo de Verificação**

**Decisão:** Campo booleano `verificationBadge` no `User` + campo `hasVerifiedDocuments` para controle.

**Raciocínio:**
- ✅ Simples e performático (não precisa fazer JOIN para verificar)
- ✅ Pode ser atualizado automaticamente quando todos os documentos são aprovados
- ✅ Visível na Torre de Controle sem queries complexas

**Lógica:**
```typescript
// Quando admin aprova último documento necessário
if (allRequiredDocumentsApproved(userId)) {
  await updateUser(userId, { 
    hasVerifiedDocuments: true,
    verificationBadge: true 
  });
}
```

---

### 4. **Expansão do Partner**

**Decisão:** Adicionar campos diretamente no modelo `Partner` + criar modelo separado `PartnerPayment` para financeiro.

**Raciocínio:**
- ✅ Dados empresariais são parte do Partner (1:1)
- ✅ Financeiro é separado para permitir histórico e múltiplos planos no futuro
- ✅ `isBlocked` no Partner permite bloqueio rápido sem JOIN

**Estrutura:**
```
Partner (1) ──→ (1) PartnerPayment
Partner (1) ──→ (N) DeliveryOrder
```

**Bloqueio Automático:**
- Job/cron verifica `PartnerPayment.status = OVERDUE`
- Se > X dias → `Partner.isBlocked = true`
- `DeliveryService.createOrder()` verifica bloqueio antes de criar pedido

---

### 5. **Matching Inteligente por Tipo de Veículo**

**Decisão:** Atualizar `DeliveryService.findMatchingRiders()` para considerar tipo de veículo.

**Raciocínio:**
- ✅ Algoritmo atual já calcula distância - só precisa ajustar critérios
- ✅ Bicicletas: corridas ≤ 3km, velocidade 15 km/h
- ✅ Motos: corridas ≤ 10km, velocidade 30 km/h
- ✅ ETA calculado dinamicamente: `(distância / velocidade_média) * 60`

**Algoritmo Atualizado:**
```typescript
1. Buscar entregadores online
2. Para cada entregador:
   a. Buscar Bike (com vehicleType)
   b. Calcular distância da corrida
   c. Se BICYCLE e distância > 3km → skip
   d. Se MOTORCYCLE e distância > 10km → skip
   e. Calcular ETA baseado no tipo
3. Ordenar: Premium → Proximidade → Reputação → ETA
```

---

### 6. **Bloqueio por Manutenção**

**Decisão:** Verificar `MaintenanceLog` antes de incluir no matching + campo `maintenanceBlockOverride` para override manual.

**Raciocínio:**
- ✅ Não quebra funcionalidades existentes (apenas filtra)
- ✅ Override permite admin desbloquear manualmente se necessário
- ✅ Verificação simples: `status = CRITICO` OU `wearPercentage >= 0.9`

**Lógica:**
```typescript
// No findMatchingRiders()
if (!rider.maintenanceBlockOverride) {
  const criticalMaintenance = await checkCriticalMaintenance(rider.id);
  if (criticalMaintenance) {
    continue; // Pula este entregador
  }
}
```

---

### 7. **Central de Disputas**

**Decisão:** Modelo `Dispute` separado com relacionamento opcional com `DeliveryOrder`.

**Raciocínio:**
- ✅ Disputas podem ser sobre entregas OU sobre outros assuntos
- ✅ `locationLogs` como JSON permite armazenar histórico de GPS
- ✅ Status workflow: OPEN → UNDER_REVIEW → RESOLVED → CLOSED

**Visualização:**
- Admin vê disputa + dados do pedido (se houver)
- Mapa com logs de geolocalização (se aplicável)
- Histórico de ações administrativas

---

### 8. **Relatórios**

**Decisão:** Endpoints REST que retornam JSON/CSV, sem criar modelos adicionais.

**Raciocínio:**
- ✅ Relatórios são queries agregadas, não precisam de modelo próprio
- ✅ Exportação pode ser feita no frontend (JSON → CSV)
- ✅ Filtros via query params

**Exemplos:**
```
GET /api/reports/partners/overdue?format=csv
GET /api/reports/riders/reliability?limit=50
```

---

## 🔄 Compatibilidade com Código Existente

### ✅ O que NÃO precisa mudar:

1. **Sistema de Autenticação** - Funciona como está
2. **Tabela User básica** - Apenas adiciona colunas
3. **Sistema de Wallet** - Continua funcionando
4. **WebSocket** - Pode ser expandido, mas não precisa mudar
5. **Estrutura de rotas** - Apenas adiciona novas rotas
6. **PostgreSQL nativo** - Projeto usa `pg` diretamente, não Prisma

### ⚠️ O que precisa atenção:

1. **Migrations SQL** - Criar cuidadosamente para não quebrar dados existentes (SQL puro, não Prisma)
2. **Validações no Bike** - Ajustar para permitir `plate` NULL quando `vehicleType = BICYCLE`
3. **Matching Algorithm** - Atualizar, mas manter compatibilidade (motos continuam funcionando)

---

## 📋 Checklist de Implementação

### Backend (giro-certo-api)

- [ ] Criar migrations SQL para novos enums
- [ ] Criar migrations SQL para novos modelos
- [ ] Atualizar `src/types/index.ts` com novos tipos
- [ ] Criar `src/services/courier-document.service.ts`
- [ ] Criar `src/services/verification-selfie.service.ts`
- [ ] Criar `src/services/partner.service.ts`
- [ ] Atualizar `src/services/delivery.service.ts` (matching)
- [ ] Criar `src/routes/courier-documents.routes.ts`
- [ ] Criar `src/routes/verification-selfies.routes.ts`
- [ ] Criar `src/routes/partners.routes.ts`
- [ ] Criar `src/routes/disputes.routes.ts`
- [ ] Criar `src/routes/reports.routes.ts`
- [ ] Atualizar `src/routes/users.routes.ts` (selo de verificação)
- [ ] Atualizar `src/routes/dashboard.routes.ts` (filtros)

### Frontend (giro-certo-next)

- [ ] Atualizar `lib/types/index.ts` com novos tipos
- [ ] Criar `app/dashboard/partners/page.tsx`
- [ ] Criar `app/dashboard/disputes/page.tsx`
- [ ] Criar `app/dashboard/reports/page.tsx`
- [ ] Atualizar `app/dashboard/control-tower/page.tsx` (filtros)
- [ ] Atualizar `app/dashboard/users/page.tsx` (documentos, selo)
- [ ] Criar componentes de upload de documentos
- [ ] Criar componentes de visualização de documentos
- [ ] Atualizar `components/map/control-tower-map.tsx` (tipo de veículo)

---

## 🚀 Próximos Passos Imediatos

1. **Revisar este plano** com a equipe
2. **Criar branch**: `feature/admin-expansion`
3. **Começar FASE 1**: VehicleType + Documentos
4. **Testar migrations** em ambiente de desenvolvimento
5. **Implementar incrementalmente** - uma fase por vez

---

## 💡 Sugestões de Melhorias Futuras (Não no escopo atual)

1. **Sistema de Notificações Push** - Para alertas em tempo real
2. **Dashboard Analytics** - Gráficos de performance
3. **Sistema de Chat** - Entre admin e entregadores/lojistas
4. **App Mobile Admin** - Para gestão em movimento
5. **Integração com Pagamentos** - Stripe/PagSeguro para PartnerPayment
6. **Machine Learning** - Otimização de rotas e matching

---

**Status:** ✅ Análise Completa - Pronto para Implementação
**Data:** 2024
