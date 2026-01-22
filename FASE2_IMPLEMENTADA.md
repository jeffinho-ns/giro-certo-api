# ✅ FASE 2 Implementada: Expansão do Modelo Partner

## 📋 Resumo

A FASE 2 foi completamente implementada! O sistema agora possui:
- ✅ Dados empresariais completos do Partner (CNPJ, Razão Social, Nome Fantasia, etc.)
- ✅ Módulo financeiro com planos de pagamento
- ✅ Sistema de bloqueio automático por inadimplência
- ✅ Configurações operacionais (raio de atendimento, tempo de preparo, horários)

---

## 🗄️ Mudanças no Banco de Dados

### Novos Enums Criados:
- `PaymentPlanType`: `MONTHLY_SUBSCRIPTION`, `PERCENTAGE_PER_ORDER`
- `PaymentStatus`: `ACTIVE`, `WARNING`, `OVERDUE`, `SUSPENDED`

### Nova Tabela:
- `PartnerPayment` - Planos de pagamento dos parceiros

### Tabela Partner Modificada:
- **Dados Empresariais:**
  - `cnpj` (único)
  - `companyName` (Razão Social)
  - `tradingName` (Nome Fantasia)
  - `stateRegistration` (Inscrição Estadual)
- **Geolocalização:**
  - `maxServiceRadius` (raio máximo de atendimento em km)
- **Operacional:**
  - `avgPreparationTime` (tempo médio de preparo em minutos)
  - `operatingHours` (horários de funcionamento - JSON)
- **Status:**
  - `isBlocked` (bloqueado se inadimplente)

---

## 📁 Arquivos Criados

### Backend:
1. **Migration SQL:**
   - `scripts/migrate-phase2-partner-expansion.sql`

2. **Serviços:**
   - `src/services/partner.service.ts` - Gestão completa de parceiros e pagamentos

3. **Rotas:**
   - `src/routes/partners.routes.ts` - CRUD de parceiros e pagamentos

4. **Scripts:**
   - `scripts/check-overdue-payments.js` - Job para verificar inadimplência

5. **Tipos TypeScript:**
   - `src/types/index.ts` (atualizado)

### Arquivos Modificados:
- `src/index.ts` - Adicionada rota `/api/partners`
- `src/services/delivery.service.ts` - Verificação de bloqueio antes de criar pedido

---

## 🚀 Como Executar a Migration

```bash
# Executar migration
node scripts/run-phase1-migration.js  # Se ainda não executou a FASE 1
node scripts/run-phase2-migration.js  # Para FASE 2 (criar script similar)
```

Ou via psql:
```bash
psql $DATABASE_URL -f scripts/migrate-phase2-partner-expansion.sql
```

---

## 🔌 Novos Endpoints da API

### Parceiros

#### `GET /api/partners`
Listar parceiros (com filtros)
```
Query params:
- type: STORE | MECHANIC
- isBlocked: true | false
- isTrusted: true | false
- limit: number
- offset: number
```

#### `GET /api/partners/:partnerId`
Buscar parceiro por ID (com informações de pagamento)

#### `POST /api/partners`
Criar parceiro (admin)
```json
{
  "name": "Restaurante XYZ",
  "type": "STORE",
  "address": "Rua ABC, 123",
  "latitude": -23.5505,
  "longitude": -46.6333,
  "phone": "11999999999",
  "email": "contato@restaurante.com",
  "cnpj": "12345678000190",
  "companyName": "Restaurante XYZ Ltda",
  "tradingName": "Restaurante XYZ",
  "stateRegistration": "123.456.789.012",
  "maxServiceRadius": 5.0,
  "avgPreparationTime": 30,
  "operatingHours": {
    "monday": {"open": "08:00", "close": "22:00"},
    "tuesday": {"open": "08:00", "close": "22:00"}
  }
}
```

#### `PUT /api/partners/:partnerId`
Atualizar parceiro (admin)

#### `PUT /api/partners/:partnerId/block`
Bloquear/desbloquear parceiro (admin)
```json
{
  "isBlocked": true
}
```

---

### Pagamentos

#### `POST /api/partners/:partnerId/payment`
Criar plano de pagamento (admin)
```json
{
  "planType": "MONTHLY_SUBSCRIPTION",
  "monthlyFee": 299.90,
  "dueDate": "2024-02-01"
}
```

ou

```json
{
  "planType": "PERCENTAGE_PER_ORDER",
  "percentageFee": 15.0
}
```

#### `GET /api/partners/:partnerId/payment`
Buscar plano de pagamento do parceiro

#### `PUT /api/partners/payment/:paymentId`
Atualizar plano de pagamento (admin)
```json
{
  "status": "OVERDUE",
  "dueDate": "2024-02-15"
}
```

#### `POST /api/partners/payment/:paymentId/record`
Registrar pagamento (admin)
```json
{
  "amount": 299.90,
  "paymentDate": "2024-01-15",
  "description": "Pagamento mensalidade janeiro"
}
```

#### `GET /api/partners/reports/overdue`
Listar parceiros inadimplentes (admin)

---

## ✅ Funcionalidades Implementadas

### 1. Dados Empresariais
- ✅ CNPJ (único)
- ✅ Razão Social
- ✅ Nome Fantasia
- ✅ Inscrição Estadual

### 2. Módulo Financeiro
- ✅ Planos de pagamento (Mensal ou Por Corrida)
- ✅ Status de pagamento (ACTIVE, WARNING, OVERDUE, SUSPENDED)
- ✅ Histórico de pagamentos (JSON)
- ✅ Data de vencimento e último pagamento

### 3. Bloqueio Automático
- ✅ Parceiros com status OVERDUE há mais de 7 dias são bloqueados automaticamente
- ✅ Parceiros bloqueados não podem criar pedidos
- ✅ Script `check-overdue-payments.js` para verificação diária

### 4. Configurações Operacionais
- ✅ Raio máximo de atendimento
- ✅ Tempo médio de preparo
- ✅ Horários de funcionamento (JSON flexível)

### 5. Integração com Delivery
- ✅ `DeliveryService.createOrder()` verifica se parceiro está bloqueado
- ✅ Retorna erro se tentar criar pedido para parceiro bloqueado

---

## 🔄 Job de Verificação de Inadimplência

O script `scripts/check-overdue-payments.js` deve ser executado diariamente (cron job):

```bash
# Executar manualmente
node scripts/check-overdue-payments.js
```

**Lógica:**
1. Busca pagamentos vencidos (status ACTIVE ou WARNING)
2. Se vencido há mais de 7 dias → status OVERDUE + bloqueia parceiro
3. Se vencido há menos de 7 dias → status WARNING
4. Se estava em WARNING e não está mais vencido → volta para ACTIVE

**Recomendação:** Configurar cron job diário:
```bash
# Adicionar ao crontab
0 0 * * * cd /path/to/giro-certo-api && node scripts/check-overdue-payments.js
```

---

## 🧪 Testes Recomendados

1. **Criar parceiro com dados empresariais:**
   ```bash
   POST /api/partners
   {
     "name": "Loja Teste",
     "type": "STORE",
     "address": "Rua Teste, 123",
     "latitude": -23.5505,
     "longitude": -46.6333,
     "cnpj": "12345678000190",
     "companyName": "Loja Teste Ltda",
     "tradingName": "Loja Teste"
   }
   ```

2. **Criar plano de pagamento mensal:**
   ```bash
   POST /api/partners/:partnerId/payment
   {
     "planType": "MONTHLY_SUBSCRIPTION",
     "monthlyFee": 299.90,
     "dueDate": "2024-02-01"
   }
   ```

3. **Registrar pagamento:**
   ```bash
   POST /api/partners/payment/:paymentId/record
   {
     "amount": 299.90,
     "paymentDate": "2024-01-15"
   }
   ```

4. **Verificar bloqueio:**
   - Criar pedido para parceiro bloqueado deve retornar erro
   - Bloquear parceiro manualmente e tentar criar pedido

---

## 📝 Próximos Passos

A FASE 2 está completa! Próximas fases:
- **FASE 3:** Lógica de matching inteligente por tipo de veículo
- **FASE 4:** Torre de Controle avançada com filtros

---

## ⚠️ Notas Importantes

1. **CNPJ Único:** O campo `cnpj` é único no banco. Não é possível ter dois parceiros com o mesmo CNPJ.
2. **Plano Ativo:** Apenas um plano pode estar com status ACTIVE por parceiro (constraint no banco).
3. **Bloqueio Automático:** O bloqueio acontece quando status = OVERDUE há mais de 7 dias.
4. **Horários de Funcionamento:** Campo JSON flexível. Exemplo:
   ```json
   {
     "monday": {"open": "08:00", "close": "22:00"},
     "tuesday": {"open": "08:00", "close": "22:00"},
     "wednesday": {"closed": true}
   }
   ```
5. **Job Diário:** Configure o script `check-overdue-payments.js` para executar diariamente.

---

**Status:** ✅ FASE 2 COMPLETA
**Data:** 2024
