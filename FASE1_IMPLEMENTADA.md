# ✅ FASE 1 Implementada: Tipos de Veículo e Documentos

## 📋 Resumo

A FASE 1 foi completamente implementada com sucesso! Agora o sistema suporta:
- ✅ Tipos de veículo (Moto e Bicicleta)
- ✅ Sistema de documentos de entregadores
- ✅ Sistema de selfies de verificação
- ✅ Selo de verificação (concedido pelo admin)
- ✅ Validações diferenciadas por tipo de veículo

---

## 🗄️ Mudanças no Banco de Dados

### Novos Enums Criados:
- `VehicleType`: `MOTORCYCLE`, `BICYCLE`
- `DocumentType`: `RG`, `CNH`, `PASSPORT`
- `DocumentStatus`: `PENDING`, `UPLOADED`, `APPROVED`, `REJECTED`, `EXPIRED`

### Novas Tabelas:
- `CourierDocument` - Documentos dos entregadores
- `VerificationSelfie` - Selfies de validação

### Tabelas Modificadas:
- `User` - Adicionados campos:
  - `hasVerifiedDocuments` (boolean)
  - `verificationBadge` (boolean)
  - `maintenanceBlockOverride` (boolean)
- `Bike` - Modificações:
  - `vehicleType` (enum, default: MOTORCYCLE)
  - `plate` (agora nullable para bicicletas)
  - `oilType`, `frontTirePressure`, `rearTirePressure` (agora nullable)
  - `vehiclePhotoUrl` (nova)
  - `platePhotoUrl` (nova)

---

## 📁 Arquivos Criados

### Backend:
1. **Migration SQL:**
   - `scripts/migrate-phase1-vehicle-documents.sql` - Migration SQL pura (PostgreSQL nativo)

2. **Serviços:**
   - `src/services/courier-document.service.ts`
   - `src/services/verification-selfie.service.ts`

3. **Rotas:**
   - `src/routes/courier-documents.routes.ts`
   - `src/routes/verification-selfies.routes.ts`

4. **Tipos TypeScript:**
   - `src/types/index.ts` (atualizado)

### Arquivos Modificados:
- `src/index.ts` - Adicionadas novas rotas
- `src/routes/bikes.routes.ts` - Validações para bicicletas
- `src/routes/users.routes.ts` - Rota para selo de verificação

---

## 🚀 Como Executar a Migration

### Opção 1: Via psql (Recomendado)
```bash
# Conectar ao banco
psql $DATABASE_URL

# Executar migration
\i scripts/migrate-phase1-vehicle-documents.sql
```

### Opção 2: Via script Node.js
```bash
# Criar um script temporário
node -e "require('pg').Pool({connectionString: process.env.DATABASE_URL}).query(require('fs').readFileSync('scripts/migrate-phase1-vehicle-documents.sql', 'utf8'), (err, res) => { if(err) console.error(err); else console.log('Migration executada!'); process.exit(0); })"
```

### Opção 3: Copiar e colar no cliente SQL
Abra o arquivo `scripts/migrate-phase1-vehicle-documents.sql` e execute no seu cliente SQL (pgAdmin, DBeaver, etc.)

---

## 🔌 Novos Endpoints da API

### Documentos de Entregadores

#### `POST /api/courier-documents`
Criar documento
```json
{
  "userId": "user_id",
  "documentType": "RG" | "CNH" | "PASSPORT",
  "fileUrl": "https://...",
  "expirationDate": "2025-12-31" // opcional
}
```

#### `GET /api/courier-documents/user/:userId`
Listar documentos de um entregador

#### `GET /api/courier-documents/:documentId`
Buscar documento por ID

#### `GET /api/courier-documents/pending/review`
Listar documentos pendentes (admin/moderator)

#### `PUT /api/courier-documents/:documentId/status`
Aprovar/rejeitar documento (admin)
```json
{
  "status": "APPROVED" | "REJECTED",
  "rejectionReason": "Motivo da rejeição", // se REJECTED
  "notes": "Observações"
}
```

#### `DELETE /api/courier-documents/:documentId`
Deletar documento

---

### Selfies de Verificação

#### `POST /api/verification-selfies`
Criar selfie
```json
{
  "userId": "user_id",
  "fileUrl": "https://..."
}
```

#### `GET /api/verification-selfies/user/:userId`
Listar selfies de um entregador

#### `GET /api/verification-selfies/:selfieId`
Buscar selfie por ID

#### `GET /api/verification-selfies/pending/review`
Listar selfies pendentes (admin/moderator)

#### `PUT /api/verification-selfies/:selfieId/status`
Aprovar/rejeitar selfie (admin)
```json
{
  "status": "APPROVED" | "REJECTED",
  "notes": "Observações"
}
```

#### `DELETE /api/verification-selfies/:selfieId`
Deletar selfie

---

### Selo de Verificação

#### `PUT /api/users/:userId/verification-badge`
Conceder/remover selo (admin)
```json
{
  "verificationBadge": true
}
```

**Validação:** Só pode conceder se `hasVerifiedDocuments = true`

---

### Bikes (Atualizado)

#### `POST /api/bikes`
Criar veículo (moto ou bicicleta)
```json
{
  "model": "Honda CG 160",
  "brand": "Honda",
  "vehicleType": "MOTORCYCLE" | "BICYCLE",
  "plate": "ABC1234", // obrigatório para motos, opcional para bicicletas
  "currentKm": 0,
  "oilType": "10W40", // opcional para bicicletas
  "frontTirePressure": 28.0, // opcional para bicicletas
  "rearTirePressure": 32.0, // opcional para bicicletas
  "photoUrl": "https://...",
  "vehiclePhotoUrl": "https://...",
  "platePhotoUrl": "https://..." // apenas para motos
}
```

**Validações:**
- Se `vehicleType = MOTORCYCLE` → `plate` é obrigatório
- Se `vehicleType = BICYCLE` → `plate` pode ser null
- Campos de óleo e pressão são opcionais para bicicletas

---

## ✅ Validações Implementadas

### Documentos:
- ✅ Usuário só pode criar documentos para si mesmo (exceto admin)
- ✅ Admin pode aprovar/rejeitar documentos
- ✅ Quando documento é aprovado, verifica se todos os documentos necessários estão aprovados
- ✅ Atualiza `hasVerifiedDocuments` automaticamente

### Selfies:
- ✅ Usuário só pode criar selfies para si mesmo (exceto admin)
- ✅ Admin pode aprovar/rejeitar selfies
- ✅ Registra quem aprovou e quando

### Selo de Verificação:
- ✅ Só pode ser concedido se `hasVerifiedDocuments = true`
- ✅ Apenas admin pode conceder/remover
- ✅ Registra quem concedeu

### Bikes:
- ✅ Validação de placa obrigatória para motos
- ✅ Placa opcional para bicicletas
- ✅ Campos de manutenção opcionais para bicicletas

---

## 🧪 Testes Recomendados

1. **Criar uma moto:**
   ```bash
   POST /api/bikes
   {
     "model": "Honda CG",
     "brand": "Honda",
     "vehicleType": "MOTORCYCLE",
     "plate": "ABC1234",
     "currentKm": 0,
     "oilType": "10W40",
     "frontTirePressure": 28.0,
     "rearTirePressure": 32.0
   }
   ```

2. **Criar uma bicicleta:**
   ```bash
   POST /api/bikes
   {
     "model": "Caloi",
     "brand": "Caloi",
     "vehicleType": "BICYCLE",
     "currentKm": 0
     // plate não é necessário
   }
   ```

3. **Upload de documento:**
   ```bash
   POST /api/courier-documents
   {
     "documentType": "RG",
     "fileUrl": "https://storage.com/document.jpg"
   }
   ```

4. **Aprovar documento (admin):**
   ```bash
   PUT /api/courier-documents/:documentId/status
   {
     "status": "APPROVED"
   }
   ```

5. **Conceder selo (admin):**
   ```bash
   PUT /api/users/:userId/verification-badge
   {
     "verificationBadge": true
   }
   ```

---

## 📝 Próximos Passos

A FASE 1 está completa! Próximas fases:
- **FASE 2:** Expansão do modelo Partner (dados empresariais, módulo financeiro)
- **FASE 3:** Lógica de matching inteligente por tipo de veículo
- **FASE 4:** Torre de Controle avançada com filtros

---

## ⚠️ Notas Importantes

1. **Compatibilidade:** Todos os bikes existentes serão automaticamente definidos como `MOTORCYCLE` (default)
2. **Migration:** Execute a migration SQL antes de iniciar o servidor. O projeto usa PostgreSQL nativo (`pg`), não Prisma
3. **Upload de Arquivos:** Os endpoints esperam `fileUrl` (URL do arquivo já armazenado). O upload em si deve ser feito via serviço de storage (S3, Cloudinary, etc.)
4. **Permissões:** Todas as rotas de aprovação requerem role `ADMIN` ou `MODERATOR`
5. **Banco de Dados:** O projeto usa PostgreSQL nativo via `pg`, todas as queries são SQL direto

---

**Status:** ✅ FASE 1 COMPLETA
**Data:** 2024
