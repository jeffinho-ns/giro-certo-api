/** Evita flood de eventos WebSocket a cada tick de GPS (PUT /me/location). */
const lastEmitMs = new Map<string, number>();
const MIN_INTERVAL_MS = 8000;

export function shouldEmitRiderLocationSocket(userId: string): boolean {
  const now = Date.now();
  const prev = lastEmitMs.get(userId) ?? 0;
  if (now - prev < MIN_INTERVAL_MS) return false;
  lastEmitMs.set(userId, now);
  return true;
}
