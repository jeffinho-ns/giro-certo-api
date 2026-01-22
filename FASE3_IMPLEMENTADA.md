# ✅ FASE 3 Implementada: Lógica de Matching Inteligente

## 📋 Resumo

A FASE 3 foi completamente implementada! O sistema agora possui:
- ✅ Matching diferenciado por tipo de veículo (Moto vs Bicicleta)
- ✅ Cálculo de ETA baseado no tipo de veículo
- ✅ Bloqueio automático por manutenção crítica
- ✅ Priorização inteligente de entregadores

---

## 🎯 Funcionalidades Implementadas

### 1. Matching Diferenciado por Tipo de Veículo

**Bicicletas:**
- ✅ Corridas até 3km
- ✅ Velocidade média: 15 km/h
- ✅ ETA calculado: `(distância / 15) * 60` minutos

**Motos:**
- ✅ Corridas até 10km
- ✅ Velocidade média: 30 km/h
- ✅ ETA calculado: `(distância / 30) * 60` minutos

### 2. Bloqueio Automático por Manutenção

- ✅ Verifica `MaintenanceLog` com `status = CRITICO`
- ✅ Verifica `MaintenanceLog` com `wearPercentage >= 0.9` (90%+)
- ✅ Exclui entregador do matching (a menos que tenha `maintenanceBlockOverride = true`)
- ✅ Verifica também no `acceptOrder()` antes de aceitar pedido

### 3. Algoritmo de Priorização Atualizado

**Ordem de prioridade:**
1. **Assinantes Premium** (mantido)
2. **Tipo de veículo adequado** (novo)
   - Bicicletas para corridas ≤ 3km
   - Motos para todas as corridas
3. **Menor ETA** (novo)
4. **Proximidade** até a loja (mantido)
5. **Reputação** (mantido)

---

## 📁 Arquivos Modificados

### Backend:
1. **Serviços:**
   - `src/services/delivery.service.ts` - Algoritmo de matching atualizado

2. **Controllers:**
   - `src/controllers/delivery.controller.ts` - Suporte a parâmetros adicionais

---

## 🔌 Endpoints Atualizados

### `GET /api/delivery/matching`

**Parâmetros de Query:**
- `lat` (obrigatório) - Latitude da loja
- `lng` (obrigatório) - Longitude da loja
- `radius` (opcional, default: 5) - Raio de busca em km
- `storeLat` (opcional) - Latitude da loja (para cálculo de distância da corrida)
- `storeLng` (opcional) - Longitude da loja
- `deliveryLat` (opcional) - Latitude do destino
- `deliveryLng` (opcional) - Longitude do destino

**Exemplo de uso:**
```
GET /api/delivery/matching?lat=-23.5505&lng=-46.6333&radius=5&storeLat=-23.5505&storeLng=-46.6333&deliveryLat=-23.5510&deliveryLng=-46.6340
```

**Resposta:**
```json
{
  "riders": [
    {
      "id": "user_id",
      "name": "João Silva",
      "email": "joao@example.com",
      "distance": 2.5,
      "deliveryDistance": 0.8,
      "vehicleType": "BICYCLE",
      "estimatedTime": 3,
      "isPremium": false,
      "averageRating": 4.5,
      "activeOrders": 0,
      "currentLat": -23.5503,
      "currentLng": -46.6331,
      "hasVerifiedBadge": true
    }
  ]
}
```

**Novos campos na resposta:**
- `deliveryDistance` - Distância da corrida completa (loja → entrega) em km
- `vehicleType` - Tipo de veículo (MOTORCYCLE ou BICYCLE)
- `estimatedTime` - Tempo estimado em minutos (calculado baseado no tipo de veículo)
- `hasVerifiedBadge` - Se tem selo de verificação

---

## 🔄 Mudanças no Algoritmo

### Antes (FASE 1-2):
```typescript
// Buscava apenas entregadores online
// Filtrava por raio até a loja
// Ordenava: Premium → Proximidade → Reputação
// ETA fixo: 3 min/km
```

### Agora (FASE 3):
```typescript
// Busca entregadores online COM tipo de veículo
// Verifica bloqueio por manutenção crítica
// Calcula distância da corrida completa (se fornecida)
// Aplica regras por tipo de veículo:
//   - Bicicletas: só corridas ≤ 3km
//   - Motos: corridas ≤ 10km
// Calcula ETA baseado no tipo de veículo:
//   - Bicicletas: 15 km/h → ETA = (distância / 15) * 60
//   - Motos: 30 km/h → ETA = (distância / 30) * 60
// Ordena: Premium → Veículo adequado → Menor ETA → Proximidade → Reputação
```

---

## ✅ Validações Implementadas

### No Matching:
1. ✅ Verifica se entregador tem manutenção crítica
2. ✅ Verifica se tem override manual (`maintenanceBlockOverride`)
3. ✅ Filtra bicicletas para corridas > 3km
4. ✅ Filtra motos para corridas > 10km
5. ✅ Calcula ETA baseado no tipo de veículo

### No Accept Order:
1. ✅ Verifica manutenção crítica antes de aceitar
2. ✅ Calcula ETA correto baseado no tipo de veículo
3. ✅ Retorna erro se entregador bloqueado

---

## 🧪 Testes Recomendados

### 1. Testar Matching com Bicicleta:
```bash
# Criar pedido de 2km (bicicleta deve aparecer)
GET /api/delivery/matching?lat=-23.5505&lng=-46.6333&storeLat=-23.5505&storeLng=-46.6333&deliveryLat=-23.5507&deliveryLng=-46.6335
```

### 2. Testar Matching com Moto:
```bash
# Criar pedido de 5km (moto deve aparecer, bicicleta não)
GET /api/delivery/matching?lat=-23.5505&lng=-46.6333&storeLat=-23.5505&storeLng=-46.6333&deliveryLat=-23.5520&deliveryLng=-46.6350
```

### 3. Testar Bloqueio por Manutenção:
```bash
# Criar MaintenanceLog com status CRITICO
# Tentar buscar matching - entregador não deve aparecer
# A menos que tenha maintenanceBlockOverride = true
```

### 4. Testar ETA:
```bash
# Verificar se ETA está correto:
# - Bicicleta: 2km → ETA = (2/15)*60 = 8 minutos
# - Moto: 5km → ETA = (5/30)*60 = 10 minutos
```

---

## 📊 Exemplo de Cálculo de ETA

### Bicicleta:
- Distância: 2.5 km
- Velocidade: 15 km/h
- ETA: (2.5 / 15) * 60 = **10 minutos**

### Moto:
- Distância: 5.0 km
- Velocidade: 30 km/h
- ETA: (5.0 / 30) * 60 = **10 minutos**

### Moto (corrida longa):
- Distância: 8.0 km
- Velocidade: 30 km/h
- ETA: (8.0 / 30) * 60 = **16 minutos**

---

## 🔍 Detalhes Técnicos

### Query SQL Atualizada:
- Busca `Bike` principal do entregador
- Verifica `MaintenanceLog` para manutenção crítica
- Calcula distâncias e ETAs em JavaScript (mais flexível)

### Performance:
- Query otimizada com JOINs eficientes
- Filtros aplicados no banco quando possível
- Cálculos de distância e ETA em memória (rápido)

---

## 📝 Próximos Passos

A FASE 3 está completa! Próximas fases:
- **FASE 4:** Torre de Controle avançada com filtros
- **FASE 5:** Gestão de Lojistas (já implementada na FASE 2)
- **FASE 6:** Central de Disputas
- **FASE 7:** Relatórios

---

## ⚠️ Notas Importantes

1. **Parâmetros Opcionais:** `storeLat`, `storeLng`, `deliveryLat`, `deliveryLng` são opcionais. Se não fornecidos, o algoritmo funciona como antes (sem filtro por tipo de veículo).

2. **Compatibilidade:** O algoritmo é retrocompatível. Se não houver informações de distância da corrida, funciona como antes.

3. **Manutenção Crítica:** Entregadores com manutenção crítica são automaticamente excluídos, a menos que tenham `maintenanceBlockOverride = true` (definido manualmente pelo admin).

4. **ETA Dinâmico:** O ETA agora é calculado dinamicamente baseado no tipo de veículo, não mais fixo em 3 min/km.

---

**Status:** ✅ FASE 3 COMPLETA
**Data:** 2024
