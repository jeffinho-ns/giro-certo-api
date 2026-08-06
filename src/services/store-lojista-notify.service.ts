import type { Application } from 'express';
import { query } from '../lib/db';
import { ioEmitToRoom } from '../utils/socket-events';

/**
 * Notifica usuários lojistas vinculados à loja após alterações feitas por admin.
 */
export async function notifyLinkedLojistasOfCatalogChange(
  app: Application | undefined,
  partnerId: string,
  summary: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const payload = {
    partnerId,
    summary,
    reason: 'admin_catalog_change',
    ...metadata,
  };

  if (app) {
    ioEmitToRoom(app, `store:${partnerId}`, 'store:catalog_updated', payload);
  }

  const users = await query<{ id: string }>(
    `SELECT id FROM "User" WHERE "partnerId" = $1`,
    [partnerId]
  );

  for (const user of users) {
    if (app) {
      ioEmitToRoom(app, `user:${user.id}`, 'store:catalog_updated', payload);
    }
  }
}
