import fs from 'fs';
import path from 'path';
import type { PoolClient } from 'pg';
import { transaction } from '../lib/db';

let ready = false;
let pending: Promise<void> | null = null;

function migrationSqlPath(): string {
  const candidates = [
    path.resolve(__dirname, '../../scripts/migrate-chat-rich.sql'),
    path.resolve(process.cwd(), 'scripts/migrate-chat-rich.sql'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Migração de chat não encontrada (scripts/migrate-chat-rich.sql).');
}

/** Parte o SQL respeitando strings e blocos dollar-quoted (DO $$ ... $$). */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  let dollarTag: string | null = null;

  while (i < sql.length) {
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      current += sql[i];
      i += 1;
      continue;
    }

    if (sql[i] === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      const chunk = end === -1 ? sql.slice(i) : sql.slice(i, end + 1);
      current += chunk;
      i += chunk.length;
      continue;
    }

    if (sql[i] === "'") {
      current += "'";
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          current += "''";
          i += 2;
          continue;
        }
        current += sql[i];
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (sql[i] === '$') {
      const match = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i));
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }

    if (sql[i] === ';') {
      const statement = current.trim();
      if (isExecutable(statement)) statements.push(statement);
      current = '';
      i += 1;
      continue;
    }

    current += sql[i];
    i += 1;
  }

  const tail = current.trim();
  if (isExecutable(tail)) statements.push(tail);
  return statements;
}

function isExecutable(statement: string): boolean {
  return statement.replace(/--.*$/gm, '').trim().length > 0;
}

export function loadChatMigrationStatements(): string[] {
  const sql = fs.readFileSync(migrationSqlPath(), 'utf8');
  return splitSqlStatements(sql);
}

export async function withDbTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return transaction(async (client: PoolClient) => fn(client));
}

async function applyChatSchema(): Promise<void> {
  const statements = loadChatMigrationStatements();
  await withDbTransaction(async (client) => {
    for (const statement of statements) {
      await client.query(statement);
    }
  });
  console.log('[chat] schema de conversas garantido');
}

/** Garante o schema no processo, para o deploy não depender de correr o script à mão. */
export function ensureChatSchema(): Promise<void> {
  if (ready) return Promise.resolve();
  if (!pending) {
    pending = applyChatSchema()
      .then(() => {
        ready = true;
      })
      .catch((error: unknown) => {
        pending = null;
        throw error;
      });
  }
  return pending;
}
