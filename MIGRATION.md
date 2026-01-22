# Migração do Prisma para PostgreSQL Nativo (pg)

Este projeto foi migrado do Prisma ORM para usar o driver PostgreSQL nativo (`pg`).

## Mudanças Realizadas

1. **Removido Prisma completamente**
   - Removido `@prisma/client` e `prisma`
   - Removido arquivos `prisma/schema.prisma` e `prisma.config.ts`
   - Removido `src/lib/prisma.ts`

2. **Implementado PostgreSQL nativo**
   - Criado `src/lib/db.ts` com helpers de query
   - Usando `pg` (PostgreSQL driver) para todas as operações de banco

3. **Atualizado todos os serviços e rotas**
   - Todas as queries foram convertidas para SQL puro
   - Mantida a mesma estrutura de dados e lógica de negócio

## Setup do Banco de Dados

### 1. Execute o script de migração

```bash
psql $DATABASE_URL -f scripts/migrate.sql
```

Ou conecte ao banco e execute o conteúdo de `scripts/migrate.sql`.

### 2. Variáveis de Ambiente

Certifique-se de ter a variável `DATABASE_URL` configurada:

```
DATABASE_URL=postgresql://user:password@host:port/database
```

## Instalação

```bash
yarn install
```

## Build

```bash
yarn build
```

## Executar

```bash
yarn dev  # desenvolvimento
yarn start  # produção
```

## Estrutura do Banco

O script `scripts/migrate.sql` cria todas as tabelas, enums, índices e relacionamentos necessários.

## Notas

- Todas as queries agora são SQL puro
- Transações são suportadas via helper `transaction()`
- IDs são gerados usando função `generateId()` (similar ao cuid)
- Tipos TypeScript foram mantidos e estão em `src/types/index.ts`
