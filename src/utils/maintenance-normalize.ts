import { MaintenanceCategory, MaintenanceStatus } from '../types';

const CATEGORY_ALIASES: Record<string, MaintenanceCategory> = {
  oleo: MaintenanceCategory.OLEO,
  oil: MaintenanceCategory.OLEO,
  lubrificante: MaintenanceCategory.OLEO,
  filtro: MaintenanceCategory.FILTROS,
  filtros: MaintenanceCategory.FILTROS,
  filter: MaintenanceCategory.FILTROS,
  pneu: MaintenanceCategory.PNEUS,
  pneus: MaintenanceCategory.PNEUS,
  tire: MaintenanceCategory.PNEUS,
  tyre: MaintenanceCategory.PNEUS,
  travao: MaintenanceCategory.TRAVOES,
  travoes: MaintenanceCategory.TRAVOES,
  freio: MaintenanceCategory.TRAVOES,
  freios: MaintenanceCategory.TRAVOES,
  brake: MaintenanceCategory.TRAVOES,
  transmissao: MaintenanceCategory.TRANSMISSAO,
  corrente: MaintenanceCategory.TRANSMISSAO,
  coroa: MaintenanceCategory.TRANSMISSAO,
  motor: MaintenanceCategory.MOTOR,
  vela: MaintenanceCategory.MOTOR,
  arrefecimento: MaintenanceCategory.MOTOR,
  coolant: MaintenanceCategory.MOTOR,
  ignicao: MaintenanceCategory.MOTOR,
};

function foldLabel(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function normalizeMaintenanceCategory(
  raw: unknown
): MaintenanceCategory | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const upper = text.toUpperCase();
  if ((Object.values(MaintenanceCategory) as string[]).includes(upper)) {
    return upper as MaintenanceCategory;
  }
  const folded = foldLabel(text);
  if (CATEGORY_ALIASES[folded]) return CATEGORY_ALIASES[folded];
  for (const [alias, value] of Object.entries(CATEGORY_ALIASES)) {
    if (alias.length >= 4 && folded.includes(alias)) return value;
  }
  return null;
}

export function normalizeMaintenanceStatus(raw: unknown): MaintenanceStatus {
  const folded = foldLabel(String(raw ?? ''));
  if (folded === 'atencao' || folded === 'warning') return MaintenanceStatus.ATENCAO;
  if (folded === 'critico' || folded === 'critical') return MaintenanceStatus.CRITICO;
  const upper = String(raw ?? '').trim().toUpperCase();
  if (upper === MaintenanceStatus.ATENCAO) return MaintenanceStatus.ATENCAO;
  if (upper === MaintenanceStatus.CRITICO) return MaintenanceStatus.CRITICO;
  return MaintenanceStatus.OK;
}

export function toFiniteInt(raw: unknown, fallback = 0): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

export function toWearPercentage(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
