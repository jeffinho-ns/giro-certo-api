# 📋 Plano de Implementação - Expansão do Painel Admin Giro Certo

## 📊 Análise do Estado Atual

### ✅ O que já existe:

#### Backend (giro-certo-api)
- ✅ Modelo `User` com sistema de roles (USER, MODERATOR, ADMIN)
- ✅ Modelo `Partner` básico (STORE, MECHANIC)
- ✅ Modelo `DeliveryOrder` com status e tracking
- ✅ Modelo `Bike` com manutenção (`MaintenanceLog`)
- ✅ Sistema de Wallet e transações
- ✅ Algoritmo de matching básico (proximidade + premium + reputação)
- ✅ Sistema de autenticação JWT
- ✅ WebSocket para tempo real
- ✅ Enums: `DeliveryStatus`, `MaintenanceStatus`, `PartnerType`, etc.

#### Frontend (giro-certo-next)
- ✅ Estrutura básica do dashboard
- ✅ Página de Torre de Controle (mock)
- ✅ Sistema de autenticação
- ✅ Componentes Shadcn/UI
- ✅ Layout com sidebar

### ❌ O que precisa ser implementado:

1. **Tipo de Veículo** (Moto/Bicicleta) - não existe
2. **Documentos de Entregadores** - não existe
3. **Sistema de Verificação Manual** - não existe
4. **Selo de Verificação** - não existe
5. **Dados Empresariais do Partner** (CNPJ, Razão Social, etc.) - não existe
6. **Módulo Financeiro do Partner** - não existe
7. **Lógica diferenciada de matching** por tipo de veículo - não existe
8. **Central de Disputas** - não existe
9. **Relatórios exportáveis** - não existe
10. **Bloqueio automático por manutenção** - não existe

---

## 🎯 Plano de Implementação Passo a Passo

### **FASE 1: Fundação - Tipos de Veículo e Documentos** ⚙️

#### 1.1 Criar Enum `VehicleType` e atualizar tabela Bike

**Arquivo:** `scripts/migrate-phase1-vehicle-documents.sql`

**Mudanças necessárias:**
- Criar enum `VehicleType` no PostgreSQL
- Adicionar coluna `vehicleType` na tabela `Bike` (default MOTORCYCLE para compatibilidade)
- Tornar `plate` nullable na tabela `Bike`
- Criar migration SQL pura (PostgreSQL nativo)

**Impacto:**
- ✅ Compatível com dados existentes (default MOTORCYCLE)
- ✅ Plate pode ser NULL para bicicletas

---

#### 1.2 Criar tabela `CourierDocument` para documentos

**Arquivo:** `scripts/migrate-phase1-vehicle-documents.sql`

**Estrutura SQL:**
```sql
CREATE TYPE "DocumentType" AS ENUM ('RG', 'CNH', 'PASSPORT');
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'UPLOADED', 'APPROVED', 'REJECTED', 'EXPIRED');

CREATE TABLE "CourierDocument" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "documentType" "DocumentType" NOT NULL,
  status "DocumentStatus" DEFAULT 'PENDING',
  "fileUrl" TEXT,
  "expirationDate" TIMESTAMP,
  "verifiedAt" TIMESTAMP,
  "verifiedBy" TEXT, -- ID do admin que aprovou
  "rejectionReason" TEXT,
  notes TEXT,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);
```

**Atualizar tabela `User`:**
- Adicionar coluna `hasVerifiedDocuments BOOLEAN DEFAULT false`
- Adicionar coluna `verificationBadge BOOLEAN DEFAULT false` (Selo de Confiança)

---

#### 1.3 Criar tabela `VerificationSelfie` para selfies de validação

**Arquivo:** `scripts/migrate-phase1-vehicle-documents.sql`

**Estrutura SQL:**
```sql
CREATE TABLE "VerificationSelfie" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "fileUrl" TEXT NOT NULL,
  status "DocumentStatus" DEFAULT 'UPLOADED',
  "verifiedAt" TIMESTAMP,
  "verifiedBy" TEXT, -- ID do admin
  notes TEXT,
  "createdAt" TIMESTAMP DEFAULT NOW()
);
```

---

#### 1.4 Atualizar tabela `Bike` para suportar bicicletas

**Arquivo:** `scripts/migrate-phase1-vehicle-documents.sql`

**Mudanças SQL:**
```sql
-- Tornar plate nullable
ALTER TABLE "Bike" ALTER COLUMN plate DROP NOT NULL;

-- Adicionar novos campos
ALTER TABLE "Bike"
  ADD COLUMN "vehicleType" "VehicleType" DEFAULT 'MOTORCYCLE',
  ADD COLUMN "oilType" TEXT, -- Tornar nullable (bicicletas não precisam)
  ADD COLUMN "frontTirePressure" DOUBLE PRECISION, -- Tornar nullable
  ADD COLUMN "rearTirePressure" DOUBLE PRECISION, -- Tornar nullable
  ADD COLUMN "vehiclePhotoUrl" TEXT,
  ADD COLUMN "platePhotoUrl" TEXT;
```

**Validação no backend:**
- Se `vehicleType = BICYCLE` → `plate` pode ser NULL
- Se `vehicleType = MOTORCYCLE` → `plate` é obrigatório

---

### **FASE 2: Expansão do Modelo Partner** 🏪

#### 2.1 Adicionar dados empresariais ao `Partner`

**Arquivo:** `scripts/migrate-phase2-partner-expansion.sql`

**Campos a adicionar:**
```sql
-- Adicionar colunas à tabela Partner
ALTER TABLE "Partner"
  ADD COLUMN cnpj TEXT UNIQUE,
  ADD COLUMN "companyName" TEXT, -- Razão Social
  ADD COLUMN "tradingName" TEXT, -- Nome Fantasia
  ADD COLUMN "stateRegistration" TEXT, -- Inscrição Estadual
  ADD COLUMN "maxServiceRadius" DOUBLE PRECISION, -- Raio máximo de atendimento em km
  ADD COLUMN "avgPreparationTime" INTEGER, -- Tempo médio de preparo em minutos
  ADD COLUMN "operatingHours" JSONB, -- Horários de funcionamento (JSON)
  ADD COLUMN "isBlocked" BOOLEAN DEFAULT false; -- Bloqueado se inadimplente

-- Exemplo de operatingHours:
-- {"monday": {"open": "08:00", "close": "22:00"}, ...}
```

---

#### 2.2 Criar tabela `PartnerPayment` para módulo financeiro

**Arquivo:** `scripts/migrate-phase2-partner-expansion.sql`

```sql
-- Criar enums
CREATE TYPE "PaymentPlanType" AS ENUM ('MONTHLY_SUBSCRIPTION', 'PERCENTAGE_PER_ORDER');
CREATE TYPE "PaymentStatus" AS ENUM ('ACTIVE', 'WARNING', 'OVERDUE', 'SUSPENDED');

-- Criar tabela PartnerPayment
CREATE TABLE "PartnerPayment" (
  id TEXT PRIMARY KEY,
  "partnerId" TEXT NOT NULL REFERENCES "Partner"(id) ON DELETE CASCADE,
  
  -- Tipo de Plano
  "planType" "PaymentPlanType" NOT NULL,
  "monthlyFee" DOUBLE PRECISION, -- Valor da mensalidade (se MONTHLY_SUBSCRIPTION)
  "percentageFee" DOUBLE PRECISION, -- Percentual por corrida (se PERCENTAGE_PER_ORDER)
  
  -- Status
  status "PaymentStatus" DEFAULT 'ACTIVE',
  "dueDate" TIMESTAMP, -- Data de vencimento
  "lastPaymentDate" TIMESTAMP, -- Último pagamento realizado
  
  -- Histórico
  "paymentHistory" JSONB, -- Array de pagamentos: [{"date": "...", "amount": 299.90, "status": "completed"}, ...]
  
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

-- Criar índices
CREATE INDEX "PartnerPayment_partnerId_idx" ON "PartnerPayment"("partnerId");
CREATE INDEX "PartnerPayment_status_idx" ON "PartnerPayment"(status);
CREATE INDEX "PartnerPayment_dueDate_idx" ON "PartnerPayment"("dueDate");
```

**Nota:** O campo `isBlocked` já foi adicionado na seção 2.1 acima.

---

### **FASE 3: Lógica de Matching Inteligente** 🎯

#### 3.1 Atualizar `DeliveryService.findMatchingRiders()`

**Arquivo:** `src/services/delivery.service.ts`

**Mudanças:**
1. Buscar tipo de veículo do entregador (via `Bike`)
2. Calcular distância da corrida (loja → entrega)
3. Aplicar regras:
   - **Bicicletas**: Priorizar corridas ≤ 3km, velocidade média 15 km/h
   - **Motos**: Raio maior (até 10km), velocidade média 30 km/h
4. Calcular ETA baseado no tipo de veículo

**Algoritmo:**
```typescript
// Pseudocódigo
for each rider:
  bike = getBikeByUserId(rider.id)
  vehicleType = bike.vehicleType
  
  distance = calculateDistance(store, delivery)
  
  if vehicleType === BICYCLE:
    if distance > 3km: skip // Bicicletas só corridas curtas
    avgSpeed = 15 km/h
  else: // MOTORCYCLE
    if distance > 10km: skip // Motos têm raio maior
    avgSpeed = 30 km/h
  
  eta = (distance / avgSpeed) * 60 // minutos
  
  score = calculateScore(rider, distance, eta, vehicleType)
```

---

#### 3.2 Adicionar bloqueio automático por manutenção

**Arquivo:** `src/services/delivery.service.ts`

**Lógica:**
- Antes de incluir entregador no matching, verificar:
  - Se tem `MaintenanceLog` com `status = CRITICO`
  - Se tem `MaintenanceLog` com `wearPercentage >= 0.9` (90%+)
- Se sim, excluir do matching (a menos que tenha override manual)

**Adicionar ao modelo `User`:**
- `maintenanceBlockOverride Boolean @default(false)` // Override manual do admin

---

### **FASE 4: Sistema de Verificação Manual** 🔐

#### 4.1 Criar rotas para upload de documentos

**Arquivo:** `src/routes/courier-documents.routes.ts`

**Endpoints:**
- `POST /api/courier-documents` - Upload de documento
- `GET /api/courier-documents/:userId` - Listar documentos do entregador
- `PUT /api/courier-documents/:documentId/approve` - Aprovar (admin)
- `PUT /api/courier-documents/:documentId/reject` - Rejeitar (admin)

---

#### 4.2 Criar rotas para selfies de verificação

**Arquivo:** `src/routes/verification-selfies.routes.ts`

**Endpoints:**
- `POST /api/verification-selfies` - Upload de selfie (entregador)
- `GET /api/verification-selfies/:userId` - Listar selfies
- `PUT /api/verification-selfies/:selfieId/approve` - Aprovar (admin)

---

#### 4.3 Criar rotas para selo de verificação

**Arquivo:** `src/routes/users.routes.ts` (adicionar)

**Endpoint:**
- `PUT /api/users/:userId/verification-badge` - Conceder/remover selo (admin)

**Lógica:**
- Só pode conceder se todos os documentos estiverem aprovados
- Registrar quem concedeu e quando

---

### **FASE 5: Torre de Controle Avançada** 🗼

#### 5.1 Atualizar endpoint de estatísticas

**Arquivo:** `src/routes/dashboard.routes.ts`

**Adicionar filtros:**
- Por tipo de veículo (Moto/Bicicleta)
- Por status de verificação (com selo / sem selo)
- Por raio de atuação

---

#### 5.2 Criar componente de filtros no frontend

**Arquivo:** `app/dashboard/control-tower/page.tsx`

**Filtros:**
- Status do pedido (dropdown)
- Tipo de veículo (checkbox: Moto / Bicicleta)
- Raio de atuação (slider)
- Status de verificação (checkbox: Verificado / Não verificado)

---

#### 5.3 Atualizar mapa com informações de veículo

**Arquivo:** `components/map/control-tower-map.tsx`

**Adicionar:**
- Ícone diferente para motos vs bicicletas
- Badge de "Verificado" nos entregadores
- ETA calculado por tipo de veículo

---

### **FASE 6: Gestão de Lojistas (Partner)** 🏬

#### 6.1 Criar rotas para gestão de Partner

**Arquivo:** `src/routes/partners.routes.ts`

**Endpoints:**
- `GET /api/partners` - Listar (com filtros)
- `GET /api/partners/:partnerId` - Detalhes
- `POST /api/partners` - Criar (admin)
- `PUT /api/partners/:partnerId` - Atualizar (admin)
- `GET /api/partners/:partnerId/payment` - Status financeiro
- `PUT /api/partners/:partnerId/payment` - Atualizar plano (admin)
- `POST /api/partners/:partnerId/payment/history` - Registrar pagamento

---

#### 6.2 Criar página de gestão de lojistas no frontend

**Arquivo:** `app/dashboard/partners/page.tsx`

**Funcionalidades:**
- Lista de lojistas com filtros
- Modal de cadastro/edição
- Aba de dados financeiros
- Status de inadimplência (visual)
- Bloqueio/desbloqueio manual

---

#### 6.3 Implementar bloqueio automático por inadimplência

**Arquivo:** `src/services/partner.service.ts` (criar)

**Lógica:**
- Job/cron que verifica `PartnerPayment.status = OVERDUE`
- Se `status = OVERDUE` por mais de X dias → `Partner.isBlocked = true`
- Quando bloqueado, não pode criar `DeliveryOrder`

**Verificar no `DeliveryService.createOrder()`:**
```typescript
if (partner.isBlocked) {
  throw new Error('Parceiro bloqueado por inadimplência');
}
```

---

### **FASE 7: Central de Disputas** ⚖️

#### 7.1 Criar tabela `Dispute`

**Arquivo:** `scripts/migrate-phase7-disputes.sql`

```sql
-- Criar enums
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED');
CREATE TYPE "DisputeType" AS ENUM ('DELIVERY_ISSUE', 'PAYMENT_ISSUE', 'RIDER_COMPLAINT', 'STORE_COMPLAINT');

-- Criar tabela Dispute
CREATE TABLE "Dispute" (
  id TEXT PRIMARY KEY,
  "deliveryOrderId" TEXT REFERENCES "DeliveryOrder"(id) ON DELETE SET NULL,
  "reportedBy" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "disputeType" "DisputeType" NOT NULL,
  status "DisputeStatus" DEFAULT 'OPEN',
  description TEXT NOT NULL,
  resolution TEXT, -- Resolução do admin
  "resolvedBy" TEXT REFERENCES "User"(id) ON DELETE SET NULL, -- ID do admin
  "resolvedAt" TIMESTAMP,
  
  -- Logs de geolocalização (se aplicável)
  "locationLogs" JSONB, -- Array de pontos GPS
  
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

-- Criar índices
CREATE INDEX "Dispute_deliveryOrderId_idx" ON "Dispute"("deliveryOrderId");
CREATE INDEX "Dispute_status_idx" ON "Dispute"(status);
CREATE INDEX "Dispute_disputeType_idx" ON "Dispute"("disputeType");
```

---

#### 7.2 Criar rotas de disputas

**Arquivo:** `src/routes/disputes.routes.ts`

**Endpoints:**
- `GET /api/disputes` - Listar (admin)
- `GET /api/disputes/:disputeId` - Detalhes
- `POST /api/disputes` - Criar (qualquer usuário)
- `PUT /api/disputes/:disputeId/resolve` - Resolver (admin)

---

#### 7.3 Criar página de Central de Disputas

**Arquivo:** `app/dashboard/disputes/page.tsx`

**Funcionalidades:**
- Lista de disputas abertas
- Filtros por tipo e status
- Modal de resolução
- Visualização de logs de geolocalização (mapa)

---

### **FASE 8: Relatórios Exportáveis** 📊

#### 8.1 Criar rotas de relatórios

**Arquivo:** `src/routes/reports.routes.ts`

**Endpoints:**
- `GET /api/reports/partners/overdue` - Lojistas inadimplentes (CSV/JSON)
- `GET /api/reports/commissions/pending` - Comissões pendentes
- `GET /api/reports/riders/reliability` - Ranking de confiabilidade

---

#### 8.2 Criar página de relatórios no frontend

**Arquivo:** `app/dashboard/reports/page.tsx`

**Funcionalidades:**
- Cards com resumo
- Botão de exportar (CSV/PDF)
- Filtros por período

---

### **FASE 9: Alertas e Notificações** 🔔

#### 9.1 Criar tabela `Alert`

**Arquivo:** `scripts/migrate-phase9-alerts.sql`

```sql
-- Criar enums
CREATE TYPE "AlertType" AS ENUM ('DOCUMENT_EXPIRING', 'MAINTENANCE_CRITICAL', 'PAYMENT_OVERDUE');
CREATE TYPE "AlertSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- Criar tabela Alert
CREATE TABLE "Alert" (
  id TEXT PRIMARY KEY,
  type "AlertType" NOT NULL,
  severity "AlertSeverity" NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  "userId" TEXT REFERENCES "User"(id) ON DELETE CASCADE, -- Se relacionado a um usuário
  "partnerId" TEXT REFERENCES "Partner"(id) ON DELETE CASCADE, -- Se relacionado a um parceiro
  "isRead" BOOLEAN DEFAULT false,
  "readAt" TIMESTAMP,
  
  "createdAt" TIMESTAMP DEFAULT NOW()
);

-- Criar índices
CREATE INDEX "Alert_userId_idx" ON "Alert"("userId");
CREATE INDEX "Alert_partnerId_idx" ON "Alert"("partnerId");
CREATE INDEX "Alert_type_idx" ON "Alert"(type);
CREATE INDEX "Alert_isRead_idx" ON "Alert"("isRead");
```

---

#### 9.2 Criar job de verificação de alertas

**Arquivo:** `src/services/alert.service.ts`

**Lógica:**
- Verificar documentos expirando (30 dias antes)
- Verificar manutenções críticas
- Verificar pagamentos atrasados
- Criar `Alert` automaticamente

---

## 📝 Ordem de Implementação Recomendada

### Sprint 1 (Fundação)
1. ✅ FASE 1.1 - Enum VehicleType
2. ✅ FASE 1.2 - Modelo CourierDocument
3. ✅ FASE 1.3 - Modelo VerificationSelfie
4. ✅ FASE 1.4 - Atualizar modelo Bike

### Sprint 2 (Matching Inteligente)
5. ✅ FASE 3.1 - Atualizar algoritmo de matching
6. ✅ FASE 3.2 - Bloqueio por manutenção

### Sprint 3 (Verificação)
7. ✅ FASE 4.1 - Rotas de documentos
8. ✅ FASE 4.2 - Rotas de selfies
9. ✅ FASE 4.3 - Sistema de selo

### Sprint 4 (Torre de Controle)
10. ✅ FASE 5.1 - Endpoint de estatísticas
11. ✅ FASE 5.2 - Componente de filtros
12. ✅ FASE 5.3 - Mapa atualizado

### Sprint 5 (Lojistas)
13. ✅ FASE 2.1 - Dados empresariais Partner
14. ✅ FASE 2.2 - Modelo PartnerPayment
15. ✅ FASE 6.1 - Rotas de Partner
16. ✅ FASE 6.2 - Página de gestão
17. ✅ FASE 6.3 - Bloqueio automático

### Sprint 6 (Disputas e Relatórios)
18. ✅ FASE 7 - Central de Disputas
19. ✅ FASE 8 - Relatórios

### Sprint 7 (Alertas)
20. ✅ FASE 9 - Sistema de alertas

---

## 🔧 Considerações Técnicas

### Migrations
- Todas as mudanças devem ter migrations SQL puras (PostgreSQL nativo)
- Usar arquivos `.sql` em `scripts/` para migrations
- Manter compatibilidade com dados existentes (defaults, nullable)
- Testar migrations em ambiente de staging antes de produção

### Validações
- Backend: Validações no service layer
- Frontend: Validações no formulário + feedback visual

### Performance
- Índices no banco para queries frequentes
- Cache de estatísticas (Redis opcional)
- Paginação em todas as listagens

### Segurança
- Upload de documentos: Validar tipo de arquivo, tamanho máximo
- Armazenar em storage seguro (S3, Cloudinary, etc.)
- Admin routes: Sempre verificar role ADMIN

### Testes
- Unit tests para services
- Integration tests para rotas críticas
- E2E tests para fluxos principais

---

## 📌 Próximos Passos Imediatos

1. **Criar branch de desenvolvimento**: `feature/admin-expansion`
2. **Começar pela FASE 1**: Fundação (VehicleType + Documentos)
3. **Criar migrations SQL** para cada mudança
4. **Atualizar tipos TypeScript** em paralelo
5. **Testar cada fase** antes de avançar

---

## 🎯 Métricas de Sucesso

- ✅ Todos os entregadores podem ser cadastrados como Moto ou Bicicleta
- ✅ Sistema de verificação manual funcionando
- ✅ Matching diferenciado por tipo de veículo
- ✅ Lojistas com dados empresariais completos
- ✅ Bloqueio automático funcionando
- ✅ Torre de Controle com filtros avançados
- ✅ Central de Disputas operacional
- ✅ Relatórios exportáveis funcionando

---

**Data de Criação:** 2024
**Última Atualização:** 2024
**Status:** 📋 Planejamento Completo - Pronto para Implementação
