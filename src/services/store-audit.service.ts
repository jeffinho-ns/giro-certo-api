import { query, queryOne } from '../lib/db';
import { generateId } from '../utils/id';

export interface StoreAuditActor {
  userId: string;
  role: string;
}

export interface StoreAuditLogEntry {
  id: string;
  partnerId: string;
  actorUserId: string | null;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string | null;
  createdAt: Date;
}

export class StoreAuditService {
  async logAudit(
    partnerId: string,
    actor: StoreAuditActor,
    action: string,
    entityType: string,
    entityId?: string,
    summary?: string
  ): Promise<StoreAuditLogEntry> {
    const id = generateId();
    await query(
      `INSERT INTO "StoreAuditLog" (
        id, "partnerId", "actorUserId", "actorRole", action, "entityType", "entityId", summary, "createdAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        id,
        partnerId,
        actor.userId,
        actor.role,
        action,
        entityType,
        entityId ?? null,
        summary ?? null,
      ]
    );
    const row = await queryOne<StoreAuditLogEntry>(
      `SELECT * FROM "StoreAuditLog" WHERE id = $1`,
      [id]
    );
    if (!row) throw new Error('Falha ao registrar auditoria');
    return row;
  }

  async listByPartner(
    partnerId: string,
    options: { limit?: number } = {}
  ): Promise<StoreAuditLogEntry[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    return query<StoreAuditLogEntry>(
      `SELECT * FROM "StoreAuditLog"
       WHERE "partnerId" = $1
       ORDER BY "createdAt" DESC
       LIMIT $2`,
      [partnerId, limit]
    );
  }
}
