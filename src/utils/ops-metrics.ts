import { query, queryOne } from '../lib/db';

let ensured = false;

async function ensureTable(): Promise<void> {
  if (ensured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS "DeliveryOpsMetric" (
      id TEXT PRIMARY KEY,
      metric TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      period_date DATE NOT NULL,
      count BIGINT NOT NULL DEFAULT 0,
      sum DOUBLE PRECISION NOT NULL DEFAULT 0,
      "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(metric, label, period_date)
    )
  `);
  ensured = true;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function metricId(metric: string, label: string, date: Date): string {
  return `ops_${metric}_${label || 'all'}_${dayKey(date)}`.replace(/[^a-zA-Z0-9_]/g, '_');
}

export async function incrementOpsMetric(
  metric: string,
  by = 1,
  label = ''
): Promise<void> {
  if (!metric) return;
  await ensureTable();
  const now = new Date();
  const id = metricId(metric, label, now);
  const period = dayKey(now);
  await query(
    `INSERT INTO "DeliveryOpsMetric" (id, metric, label, period_date, count, sum, "updatedAt")
     VALUES ($1, $2, $3, $4::date, $5, 0, NOW())
     ON CONFLICT (metric, label, period_date)
     DO UPDATE SET
       count = "DeliveryOpsMetric".count + EXCLUDED.count,
       "updatedAt" = NOW()`,
    [id, metric, label, period, by]
  );
}

export async function observeOpsMetric(
  metric: string,
  value: number,
  label = ''
): Promise<void> {
  if (!metric || !Number.isFinite(value) || value < 0) return;
  await ensureTable();
  const now = new Date();
  const id = metricId(metric, label, now);
  const period = dayKey(now);
  await query(
    `INSERT INTO "DeliveryOpsMetric" (id, metric, label, period_date, count, sum, "updatedAt")
     VALUES ($1, $2, $3, $4::date, 1, $5, NOW())
     ON CONFLICT (metric, label, period_date)
     DO UPDATE SET
       count = "DeliveryOpsMetric".count + 1,
       sum = "DeliveryOpsMetric".sum + EXCLUDED.sum,
       "updatedAt" = NOW()`,
    [id, metric, label, period, value]
  );
}

type RollupRow = {
  metric: string;
  label: string;
  count: string;
  sum: string;
};

export async function getOpsMetricsForDays(days: number): Promise<RollupRow[]> {
  await ensureTable();
  const safeDays = Math.max(1, Math.min(days, 90));
  return query<RollupRow>(
    `SELECT metric, label, SUM(count)::text as count, SUM(sum)::text as sum
     FROM "DeliveryOpsMetric"
     WHERE period_date >= (CURRENT_DATE - ($1::int - 1))
     GROUP BY metric, label`,
    [safeDays]
  );
}

export async function getOpsMetricValue(
  metric: string,
  days: number,
  label = ''
): Promise<{ count: number; sum: number }> {
  await ensureTable();
  const safeDays = Math.max(1, Math.min(days, 90));
  const row = await queryOne<{ count: string; sum: string }>(
    `SELECT COALESCE(SUM(count), 0)::text as count, COALESCE(SUM(sum), 0)::text as sum
     FROM "DeliveryOpsMetric"
     WHERE metric = $1
       AND label = $2
       AND period_date >= (CURRENT_DATE - ($3::int - 1))`,
    [metric, label, safeDays]
  );
  return {
    count: Number(row?.count ?? '0'),
    sum: Number(row?.sum ?? '0'),
  };
}
