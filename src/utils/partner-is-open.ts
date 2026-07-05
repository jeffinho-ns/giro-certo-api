/**
 * Calcula se a loja está aberta agora.
 * - Bloqueada → fechada
 * - Sem operatingHours (ou vazio) → aberta se não bloqueada
 * - Com operatingHours → usa o dia/hora em America/Sao_Paulo
 *
 * Formato esperado:
 * { "monday": { "open": "08:00", "close": "22:00" }, "sunday": { "closed": true } }
 */
export function computePartnerIsOpen(
  isBlocked: boolean,
  operatingHours: unknown
): boolean {
  if (isBlocked) return false;
  if (
    !operatingHours ||
    typeof operatingHours !== 'object' ||
    Array.isArray(operatingHours)
  ) {
    return true;
  }

  const hoursMap = operatingHours as Record<string, unknown>;
  if (Object.keys(hoursMap).length === 0) return true;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());

  const weekday = parts.find((p) => p.type === 'weekday')?.value?.toLowerCase();
  const hourStr = parts.find((p) => p.type === 'hour')?.value;
  const minuteStr = parts.find((p) => p.type === 'minute')?.value;
  if (!weekday || hourStr == null || minuteStr == null) return true;

  const dayHours = hoursMap[weekday];
  if (!dayHours || typeof dayHours !== 'object' || Array.isArray(dayHours)) {
    return false;
  }

  const day = dayHours as { open?: string; close?: string; closed?: boolean };
  if (day.closed) return false;
  if (!day.open || !day.close) return false;

  const toMinutes = (t: string): number | null => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(t).trim());
    if (!match) return null;
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (!Number.isFinite(h) || !Number.isFinite(m) || h > 24 || m > 59) return null;
    return Math.min(h, 23) * 60 + m;
  };

  // hourCycle h23 pode retornar "24" à meia-noite em alguns engines
  const hourNum = hourStr === '24' ? 0 : Number(hourStr);
  const minuteNum = Number(minuteStr);
  if (!Number.isFinite(hourNum) || !Number.isFinite(minuteNum)) return true;

  const nowMinutes = hourNum * 60 + minuteNum;
  const openMinutes = toMinutes(day.open);
  const closeMinutes = toMinutes(day.close);
  if (openMinutes == null || closeMinutes == null) return false;

  // Fecha à meia-noite seguinte (ex.: 22:00–02:00)
  if (closeMinutes <= openMinutes) {
    return nowMinutes >= openMinutes || nowMinutes < closeMinutes;
  }
  return nowMinutes >= openMinutes && nowMinutes < closeMinutes;
}
