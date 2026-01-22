# ✅ FASE 6 Implementada: Central de Disputas

## 📋 Resumo

A FASE 6 foi completamente implementada! O sistema agora possui uma Central de Disputas completa para mediação de conflitos, com backend e frontend totalmente funcionais.

---

## 🗄️ Mudanças no Banco de Dados

### Novos Enums Criados:
- `DisputeStatus`: `OPEN`, `UNDER_REVIEW`, `RESOLVED`, `CLOSED`
- `DisputeType`: `DELIVERY_ISSUE`, `PAYMENT_ISSUE`, `RIDER_COMPLAINT`, `STORE_COMPLAINT`

### Nova Tabela:
- `Dispute` - Central de disputas

**Campos:**
- `id` (TEXT PRIMARY KEY)
- `deliveryOrderId` (TEXT, FK para DeliveryOrder, nullable)
- `reportedBy` (TEXT, FK para User, obrigatório)
- `disputeType` (DisputeType, obrigatório)
- `status` (DisputeStatus, default: OPEN)
- `description` (TEXT, obrigatório)
- `resolution` (TEXT, nullable) - Resolução do admin
- `resolvedBy` (TEXT, FK para User, nullable) - ID do admin
- `resolvedAt` (TIMESTAMP, nullable)
- `locationLogs` (JSONB, nullable) - Array de pontos GPS
- `createdAt` (TIMESTAMP)
- `updatedAt` (TIMESTAMP)

**Índices:**
- `Dispute_deliveryOrderId_idx`
- `Dispute_status_idx`
- `Dispute_disputeType_idx`
- `Dispute_reportedBy_idx`
- `Dispute_createdAt_idx`

---

## 📁 Arquivos Criados

### Backend:
1. **Migration SQL:**
   - `scripts/migrate-phase6-disputes.sql`

2. **Serviços:**
   - `src/services/dispute.service.ts` - Gestão completa de disputas

3. **Rotas:**
   - `src/routes/disputes.routes.ts` - CRUD de disputas

4. **Scripts:**
   - `scripts/run-phase6-migration.js` - Script para executar migration

5. **Tipos TypeScript:**
   - `src/types/index.ts` (atualizado)

### Frontend:
1. **Páginas:**
   - `app/dashboard/disputes/page.tsx` (criado)

2. **Componentes:**
   - `components/ui/textarea.tsx` (criado)

3. **Tipos:**
   - `lib/types/index.ts` (atualizado)

### Arquivos Modificados:
- `src/index.ts` - Adicionada rota `/api/disputes`

---

## 🚀 Como Executar a Migration

```bash
# Executar migration
node scripts/run-phase6-migration.js
```

Ou via psql:
```bash
psql $DATABASE_URL -f scripts/migrate-phase6-disputes.sql
```

---

## 🔌 Novos Endpoints da API

### Disputas

#### `GET /api/disputes`
Listar disputas (admin/moderator)

**Query Params:**
- `status` (opcional) - OPEN | UNDER_REVIEW | RESOLVED | CLOSED
- `disputeType` (opcional) - DELIVERY_ISSUE | PAYMENT_ISSUE | RIDER_COMPLAINT | STORE_COMPLAINT
- `deliveryOrderId` (opcional) - ID do pedido
- `reportedBy` (opcional) - ID do usuário que reportou
- `limit` (opcional, default: 50)
- `offset` (opcional, default: 0)

**Resposta:**
```json
{
  "disputes": [
    {
      "id": "dispute_id",
      "deliveryOrderId": "order_id",
      "reportedBy": "user_id",
      "disputeType": "DELIVERY_ISSUE",
      "status": "OPEN",
      "description": "Descrição da disputa...",
      "resolution": null,
      "resolvedBy": null,
      "resolvedAt": null,
      "locationLogs": null,
      "createdAt": "2024-01-01T10:00:00Z",
      "updatedAt": "2024-01-01T10:00:00Z",
      "deliveryOrder": {...},
      "reporter": {
        "id": "user_id",
        "name": "João Silva",
        "email": "joao@example.com"
      }
    }
  ],
  "total": 10
}
```

#### `GET /api/disputes/:disputeId`
Buscar disputa por ID (admin/moderator)

**Resposta:**
```json
{
  "dispute": {
    "id": "dispute_id",
    "deliveryOrderId": "order_id",
    "reportedBy": "user_id",
    "disputeType": "DELIVERY_ISSUE",
    "status": "OPEN",
    "description": "Descrição completa...",
    "deliveryOrder": {
      "id": "order_id",
      "status": "completed",
      "value": 50.00,
      "storeAddress": "Rua ABC, 123",
      "deliveryAddress": "Rua XYZ, 456"
    },
    "reporter": {...},
    "resolver": null
  }
}
```

#### `POST /api/disputes`
Criar disputa (qualquer usuário autenticado)

**Body:**
```json
{
  "deliveryOrderId": "order_id", // opcional
  "disputeType": "DELIVERY_ISSUE",
  "description": "Descrição detalhada da disputa...",
  "locationLogs": [ // opcional
    {
      "lat": -23.5505,
      "lng": -46.6333,
      "timestamp": "2024-01-01T10:00:00Z"
    }
  ]
}
```

#### `PUT /api/disputes/:disputeId/resolve`
Resolver disputa (admin)

**Body:**
```json
{
  "resolution": "Resolução aplicada pelo admin...",
  "status": "RESOLVED" // ou "CLOSED"
}
```

#### `PUT /api/disputes/:disputeId/status`
Atualizar status da disputa (admin)

**Body:**
```json
{
  "status": "UNDER_REVIEW"
}
```

#### `DELETE /api/disputes/:disputeId`
Deletar disputa (admin, apenas se fechada)

#### `GET /api/disputes/stats/summary`
Estatísticas de disputas (admin/moderator)

**Resposta:**
```json
{
  "total": 50,
  "open": 10,
  "underReview": 5,
  "resolved": 25,
  "closed": 10,
  "byType": {
    "DELIVERY_ISSUE": 30,
    "PAYMENT_ISSUE": 10,
    "RIDER_COMPLAINT": 5,
    "STORE_COMPLAINT": 5
  }
}
```

---

## ✅ Funcionalidades Implementadas

### Backend:
- ✅ CRUD completo de disputas
- ✅ Filtros por status e tipo
- ✅ Relacionamento com pedidos (opcional)
- ✅ Logs de geolocalização (JSONB)
- ✅ Resolução de disputas por admin
- ✅ Estatísticas agregadas
- ✅ Validações e permissões

### Frontend:
- ✅ Lista de disputas com cards visuais
- ✅ Filtros por status e tipo
- ✅ Estatísticas em cards
- ✅ Modal de detalhes completo
- ✅ Visualização de pedido relacionado
- ✅ Visualização de logs de geolocalização (mapa)
- ✅ Modal de resolução
- ✅ Atualização de status
- ✅ Badges coloridos por status e tipo

---

## 🎨 Funcionalidades do Frontend

### 1. Dashboard de Disputas
- ✅ Cards de estatísticas (Total, Abertas, Em Análise, Resolvidas, Fechadas)
- ✅ Filtros interativos (Status e Tipo)
- ✅ Lista de disputas com informações principais

### 2. Modal de Detalhes
- ✅ Informações completas da disputa
- ✅ Dados do reportador
- ✅ Descrição completa
- ✅ Pedido relacionado (se houver)
- ✅ Logs de geolocalização (mapa)
- ✅ Resolução (se aplicável)

### 3. Resolução de Disputas
- ✅ Modal para resolver disputa
- ✅ Campo de resolução (textarea)
- ✅ Seleção de status final (Resolvida ou Fechada)
- ✅ Registro de quem resolveu e quando

### 4. Gestão de Status
- ✅ Botão para marcar como "Em Análise"
- ✅ Botão para fechar disputa
- ✅ Atualização automática após mudanças

---

## 🔐 Permissões

### Usuários Autenticados:
- ✅ Criar disputas

### Moderadores:
- ✅ Visualizar lista de disputas
- ✅ Ver detalhes completos
- ✅ Ver estatísticas

### Administradores:
- ✅ Todas as permissões de moderador
- ✅ Resolver disputas
- ✅ Atualizar status
- ✅ Deletar disputas (apenas fechadas)

---

## 🧪 Como Usar

### 1. Acessar Central de Disputas:
```
/dashboard/disputes
```

### 2. Filtrar Disputas:
- Use os filtros no topo para filtrar por status ou tipo
- Clique em "Limpar Filtros" para resetar

### 3. Ver Detalhes:
- Clique em qualquer card de disputa
- Visualize todas as informações no modal

### 4. Resolver Disputa (Admin):
- Abra os detalhes da disputa
- Clique em "Resolver Disputa"
- Preencha a resolução
- Selecione o status final
- Salve

### 5. Atualizar Status (Admin):
- Use os botões no modal de detalhes
- "Marcar como Em Análise" (se aberta)
- "Fechar Disputa" (se resolvida)

---

## 📝 Próximos Passos

A FASE 6 está completa! Próximas fases:
- **FASE 7:** Relatórios Exportáveis
- **FASE 8:** Sistema de Alertas

---

## ⚠️ Notas Importantes

1. **Permissões:** A página requer permissão de Moderador. Apenas Admins podem resolver disputas.

2. **Pedidos Relacionados:** Disputas podem ser criadas sem estar relacionadas a um pedido.

3. **Logs de Geolocalização:** Campo JSONB flexível para armazenar histórico de GPS quando aplicável.

4. **Status Workflow:** OPEN → UNDER_REVIEW → RESOLVED → CLOSED

5. **Deleção:** Apenas disputas fechadas podem ser deletadas.

6. **React Query:** A página usa React Query para cache e atualização automática.

---

**Status:** ✅ FASE 6 COMPLETA
**Data:** 2024
