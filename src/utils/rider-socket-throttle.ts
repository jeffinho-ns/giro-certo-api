/** Evita flood de eventos WebSocket a cada tick de GPS (PUT /me/location). */
const lastEmitMs = new Map<string, number>();
const MIN_INTERVAL_MS = 8000;
const NAVIGATION_INTERVAL_MS = 4000;

/** Atualiza o relógio de throttle (ex.: após emit forçado por checkpoint). */
export function touchRiderLocationSocketThrottle(userId: string): void {
  lastEmitMs.set(userId, Date.now());
}

export function shouldEmitRiderLocationSocket(
  userId: string,
  options?: { navigationActive?: boolean }
): boolean {
  const now = Date.now();
  const prev = lastEmitMs.get(userId) ?? 0;
  const minInterval = options?.navigationActive ? NAVIGATION_INTERVAL_MS : MIN_INTERVAL_MS;
  if (now - prev < minInterval) return false;
  lastEmitMs.set(userId, now);
  return true;
}
