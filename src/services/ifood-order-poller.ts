import type { Application } from 'express';
import { ifoodCredentialsConfigured } from './ifood-client';
import { IfoodOrderImportService } from './ifood-order-import.service';

const POLL_MS = 30_000;

export function startIfoodOrderPoller(app: Application): void {
  if (!ifoodCredentialsConfigured()) {
    console.log('[ifood] polling desligado (sem IFOOD_CLIENT_ID/SECRET).');
    return;
  }

  const importer = new IfoodOrderImportService();
  const tick = () => {
    void importer.pollLinkedMerchants(app).catch((error) => {
      console.warn('[ifood] polling:', error instanceof Error ? error.message : error);
    });
  };

  setTimeout(tick, 5_000);
  setInterval(tick, POLL_MS);
  console.log('[ifood] polling de pedidos a cada 30s.');
}
