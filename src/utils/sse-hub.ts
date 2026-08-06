import { randomBytes } from 'crypto';
import type { Response } from 'express';

interface SseConnection {
  id: string;
  res: Response;
  channels: Set<string>;
  heartbeat: ReturnType<typeof setInterval>;
}

const connections = new Map<string, SseConnection>();
const channelSubs = new Map<string, Set<string>>();

export function formatSseMessage(event: string, data: unknown, id?: string): string {
  const lines: string[] = [];
  if (id) lines.push(`id: ${id}`);
  lines.push(`event: ${event}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  lines.push('');
  return lines.join('\n');
}

export function subscribeSse(res: Response, channels: string[]): string {
  const id = randomBytes(8).toString('hex');
  const uniqueChannels = [...new Set(channels.filter(Boolean))];

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof (res as any).flushHeaders === 'function') {
    (res as any).flushHeaders();
  }

  res.write(': connected\n\n');

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      unsubscribeSse(id);
    }
  }, 25_000);

  const conn: SseConnection = {
    id,
    res,
    channels: new Set(uniqueChannels),
    heartbeat,
  };
  connections.set(id, conn);

  for (const ch of uniqueChannels) {
    if (!channelSubs.has(ch)) channelSubs.set(ch, new Set());
    channelSubs.get(ch)!.add(id);
  }

  res.on('close', () => unsubscribeSse(id));
  return id;
}

export function unsubscribeSse(id: string): void {
  const conn = connections.get(id);
  if (!conn) return;
  clearInterval(conn.heartbeat);
  for (const ch of conn.channels) {
    channelSubs.get(ch)?.delete(id);
    if (channelSubs.get(ch)?.size === 0) channelSubs.delete(ch);
  }
  connections.delete(id);
}

export function ssePublish(channel: string, event: string, payload: unknown): void {
  const subs = channelSubs.get(channel);
  if (!subs || subs.size === 0) return;
  const msg = formatSseMessage(event, payload);
  for (const clientId of [...subs]) {
    const conn = connections.get(clientId);
    if (!conn) continue;
    try {
      conn.res.write(msg);
    } catch {
      unsubscribeSse(clientId);
    }
  }
}

export function ssePublishGlobal(event: string, payload: unknown): void {
  if (connections.size === 0) return;
  const msg = formatSseMessage(event, payload);
  for (const [clientId, conn] of connections) {
    try {
      conn.res.write(msg);
    } catch {
      unsubscribeSse(clientId);
    }
  }
}

/** Canal público da vitrine: status do pedido por trackingToken. */
export function ssePublishStoreOrder(
  trackingToken: string,
  event: string,
  payload: unknown
): void {
  if (!trackingToken?.trim()) return;
  ssePublish(`store-order:${trackingToken.trim()}`, event, payload);
}
