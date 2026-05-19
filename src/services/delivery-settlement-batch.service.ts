import { generateId } from '../utils/id';
import { query, queryOne, transaction, execute } from '../lib/db';
import {
  assertPayoutProfileShape,
  buildAsaasTransferPayloadFromProfile,
} from '../lib/payout-bank-account';
import { asaasCreateOutboundTransfer, asaasGetTransfer, isAsaasConfigured } from './asaas.service';

export type SettlementFrequency = 'daily' | 'weekly' | 'monthly';

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function defaultFeeFromEnv(freq: SettlementFrequency): number {
  switch (freq) {
    case 'daily':
      return roundMoney(Number(process.env.GIRO_SETTLEMENT_FEE_DAILY ?? 2));
    case 'monthly':
      return roundMoney(Number(process.env.GIRO_SETTLEMENT_FEE_MONTHLY ?? 40));
    case 'weekly':
    default:
      return roundMoney(Number(process.env.GIRO_SETTLEMENT_FEE_WEEKLY ?? 50));
  }
}

function parseFrequency(raw: string | null | undefined, fallback: SettlementFrequency): SettlementFrequency {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'daily' || s === 'weekly' || s === 'monthly') return s;
  return fallback;
}

export interface ComposeBatchesOpts {
  /** ISO opcional — só agrupa linhas com `DeliverySettlementLedger.createdAt` <= esse instante */
  cutoffAt?: string;
}

export interface DeliverySettlementBatchRow {
  id: string;
  beneficiary_type: string;
  partner_id: string | null;
  rider_user_id: string | null;
  gross_amount: number;
  settlement_fee_flat: number;
  net_payable: number;
  line_count: number;
  currency: string;
  settlement_frequency: string;
  status: string;
  asaas_transfer_id: string | null;
  external_reference: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class DeliverySettlementBatchService {
  private resolvePartnerFee(planFreq: SettlementFrequency, override: number | null): number {
    if (override != null && Number.isFinite(override) && override >= 0) {
      return roundMoney(Number(override));
    }
    return defaultFeeFromEnv(planFreq);
  }

  /** Agrupa todas as linhas `pending` do livro em lotes por loja / por rider. */
  async composeBatchesFromLedger(opts?: ComposeBatchesOpts): Promise<{
    batches: string[];
    partnerBatches: number;
    riderBatches: number;
  }> {
    let cutoffTs: Date | null = null;
    if (opts?.cutoffAt) {
      const d = new Date(opts.cutoffAt);
      if (Number.isNaN(d.getTime())) {
        throw new Error('cutoffAt inválido — use ISO-8601 com timezone');
      }
      cutoffTs = d;
    }

    return transaction(async (client) => {
      const batches: string[] = [];
      let partnerBatches = 0;
      let riderBatches = 0;

      const cutoffFrag = cutoffTs ? `AND l."createdAt" <= $1::timestamptz` : '';
      const cutoffParams: unknown[] = cutoffTs ? [cutoffTs.toISOString()] : [];

      const storeAgg = await client.query(
        `SELECT 
          l."storeId" AS sid,
          SUM(l."storeNetAmount")::text AS gross,
          array_agg(l.id ORDER BY l."createdAt") AS ledger_ids
         FROM "DeliverySettlementLedger" l
         WHERE l.settlement_status = 'pending'
           AND l.settlement_batch_id IS NULL
           ${cutoffFrag}
         GROUP BY l."storeId"`,
        cutoffParams
      );

      for (const row of storeAgg.rows as Array<{
        sid: string;
        gross: string;
        ledger_ids: string[];
      }>) {
        const gross = roundMoney(Number.parseFloat(row.gross) || 0);
        if (gross < 0.01 || !row.ledger_ids?.length) continue;

        const partnerRow = await client.query(
          `SELECT delivery_settlement_frequency, delivery_settlement_fee_flat_override
           FROM "Partner" WHERE id = $1`,
          [row.sid]
        );
        const pr = partnerRow.rows[0] as {
          delivery_settlement_frequency: string | null;
          delivery_settlement_fee_flat_override: number | null;
        } | undefined;
        const freq = parseFrequency(pr?.delivery_settlement_frequency, 'weekly');
        const feeFlat = this.resolvePartnerFee(freq, pr?.delivery_settlement_fee_flat_override ?? null);
        const netPayable = roundMoney(Math.max(0, gross - feeFlat));
        const batchId = generateId();
        const batchStatus =
          netPayable < 0.01 ? ('no_transfer' as const) : ('pending_transfer' as const);

        await client.query(
          `INSERT INTO "DeliverySettlementBatch" (
            id, beneficiary_type, partner_id, rider_user_id,
            gross_amount, settlement_fee_flat, net_payable, line_count,
            currency, settlement_frequency, status, external_reference, "createdAt", "updatedAt"
          ) VALUES (
            $1, 'partner', $2, NULL,
            $3, $4, $5, $6,
            'BRL', $7, $8, $1, NOW(), NOW()
          )`,
          [
            batchId,
            row.sid,
            gross,
            feeFlat,
            netPayable,
            row.ledger_ids.length,
            freq,
            batchStatus,
          ]
        );

        await client.query(
          `UPDATE "DeliverySettlementLedger"
           SET settlement_batch_id = $2,
               settlement_status = 'batched',
               "updatedAt" = NOW()
           WHERE id = ANY($1::text[])`,
          [row.ledger_ids, batchId]
        );

        batches.push(batchId);
        partnerBatches += 1;
      }

      const riderAgg = await client.query(
        `SELECT 
          l."riderUserId" AS rid,
          SUM(l."riderNetAmount")::text AS gross,
          array_agg(l.id ORDER BY l."createdAt") AS ledger_ids
         FROM "DeliverySettlementLedger" l
         WHERE l.settlement_status = 'pending'
           AND l.settlement_batch_id IS NULL
           AND l."riderUserId" IS NOT NULL
           ${cutoffFrag}
         GROUP BY l."riderUserId"`,
        cutoffParams
      );

      const riderFallback = parseFrequency(
        process.env.GIRO_RIDER_DEFAULT_SETTLEMENT_FREQUENCY,
        'weekly'
      );

      for (const row of riderAgg.rows as Array<{
        rid: string;
        gross: string;
        ledger_ids: string[];
      }>) {
        const gross = roundMoney(Number.parseFloat(row.gross) || 0);
        if (gross < 0.01 || !row.ledger_ids?.length) continue;

        const userRow = await client.query(
          `SELECT delivery_settlement_frequency, delivery_settlement_fee_flat_override
           FROM "User" WHERE id = $1`,
          [row.rid]
        );
        const ur = userRow.rows[0] as {
          delivery_settlement_frequency: string | null;
          delivery_settlement_fee_flat_override: number | null;
        } | undefined;
        const freq = parseFrequency(
          ur?.delivery_settlement_frequency ?? null,
          riderFallback
        );
        const feeFlat = this.resolvePartnerFee(freq, ur?.delivery_settlement_fee_flat_override ?? null);
        const netPayable = roundMoney(Math.max(0, gross - feeFlat));
        const batchId = generateId();
        const batchStatus =
          netPayable < 0.01 ? ('no_transfer' as const) : ('pending_transfer' as const);

        await client.query(
          `INSERT INTO "DeliverySettlementBatch" (
            id, beneficiary_type, partner_id, rider_user_id,
            gross_amount, settlement_fee_flat, net_payable, line_count,
            currency, settlement_frequency, status, external_reference, "createdAt", "updatedAt"
          ) VALUES (
            $1, 'rider', NULL, $2,
            $3, $4, $5, $6,
            'BRL', $7, $8, $1, NOW(), NOW()
          )`,
          [
            batchId,
            row.rid,
            gross,
            feeFlat,
            netPayable,
            row.ledger_ids.length,
            freq,
            batchStatus,
          ]
        );

        await client.query(
          `UPDATE "DeliverySettlementLedger"
           SET settlement_batch_id = $2,
               settlement_status = 'batched',
               "updatedAt" = NOW()
           WHERE id = ANY($1::text[])`,
          [row.ledger_ids, batchId]
        );

        batches.push(batchId);
        riderBatches += 1;
      }

      return { batches, partnerBatches, riderBatches };
    });
  }

  async listBatches(limit = 40, opts?: { status?: string }): Promise<DeliverySettlementBatchRow[]> {
    const lim = Math.min(Math.max(limit, 1), 100);
    if (opts?.status) {
      return query(
        `SELECT * FROM "DeliverySettlementBatch"
         WHERE status = $1
         ORDER BY "createdAt" DESC LIMIT $2`,
        [opts.status, lim]
      );
    }
    return query(`SELECT * FROM "DeliverySettlementBatch" ORDER BY "createdAt" DESC LIMIT $1`, [
      lim,
    ]);
  }

  async getBatchById(batchId: string): Promise<DeliverySettlementBatchRow | null> {
    return queryOne<DeliverySettlementBatchRow>(
      `SELECT * FROM "DeliverySettlementBatch" WHERE id = $1`,
      [batchId]
    );
  }

  /**
   * Conta gravada pelo beneficiário (`payout_bank_account_json`), usada quando o admin não envia `bankAccount`.
   */
  async resolveStoredPayoutBankAccount(
    client: {
      query: (
        sql: string,
        params?: unknown[]
      ) => Promise<{ rows: Array<{ payout_bank_account_json?: unknown }> }>;
    },
    batch: Pick<DeliverySettlementBatchRow, 'beneficiary_type' | 'partner_id' | 'rider_user_id'>
  ): Promise<Record<string, unknown>> {
    if (batch.beneficiary_type === 'partner') {
      const pid = batch.partner_id?.trim();
      if (!pid) {
        throw new Error('Lote de loja sem partner_id');
      }
      const r = await client.query(
        `SELECT payout_bank_account_json FROM "Partner" WHERE id = $1`,
        [pid]
      );
      const row = r.rows[0];
      return assertPayoutProfileShape(row?.payout_bank_account_json ?? null);
    }
    if (batch.beneficiary_type === 'rider') {
      const uid = batch.rider_user_id?.trim();
      if (!uid) {
        throw new Error('Lote de rider sem rider_user_id');
      }
      const r = await client.query(
        `SELECT payout_bank_account_json FROM "User" WHERE id = $1`,
        [uid]
      );
      const row = r.rows[0];
      return assertPayoutProfileShape(row?.payout_bank_account_json ?? null);
    }
    throw new Error(`Tipo de beneficiário desconhecido: ${batch.beneficiary_type}`);
  }

  /**
   * Solicita PIX/TED no Asaas. Requer `ASAAS_ENABLE_PAYOUTS=true` e corpo compatível com a API `/transfers`.
   * `bankAccount` opcional quando o beneficiário já tem `payout_bank_account_json`.
   * Ao sucesso, marca linhas do livro como `settled`.
   */
  async executeOutboundTransfer(opts: {
    batchId: string;
    bankAccount?: Record<string, unknown> | null;
    description?: string;
  }): Promise<{ asaasTransferId: string | null }> {
    if (process.env.ASAAS_ENABLE_PAYOUTS !== 'true') {
      throw new Error(
        'Transferências desativadas (defina ASAAS_ENABLE_PAYOUTS=true no servidor para executar repasses)'
      );
    }
    if (!isAsaasConfigured()) {
      throw new Error('ASAAS_API_KEY não configurada');
    }

    return transaction(async (client) => {
      const batch = await client.query(
        `SELECT * FROM "DeliverySettlementBatch" WHERE id = $1 FOR UPDATE`,
        [opts.batchId]
      );
      const b = batch.rows[0] as DeliverySettlementBatchRow | undefined;
      if (!b) {
        throw new Error('Lote não encontrado');
      }
      if (b.status !== 'pending_transfer') {
        throw new Error(
          `Lote não está elegível para transferência (status=${b.status}). Só pending_transfer.`
        );
      }
      if (b.net_payable < 0.01) {
        throw new Error('Valor líquido do lote insuficiente para transferência');
      }

      const externalRef = b.external_reference || b.id;
      const desc =
        opts.description ||
        `Repasse Giro Certo ${b.beneficiary_type} #${b.id.slice(-8)}`;

      let profilePayload: Record<string, unknown>;
      if (opts.bankAccount && typeof opts.bankAccount === 'object') {
        profilePayload = assertPayoutProfileShape(opts.bankAccount);
      } else {
        profilePayload = await this.resolveStoredPayoutBankAccount(client, b);
      }

      const transferBody = buildAsaasTransferPayloadFromProfile(profilePayload);

      const remote = (await asaasCreateOutboundTransfer({
        value: b.net_payable,
        ...transferBody,
        description: desc,
        externalReference: externalRef,
      })) as Record<string, unknown>;

      const tid =
        typeof remote.id === 'string'
          ? remote.id
          : typeof remote.transferId === 'string'
            ? remote.transferId
            : null;

      await client.query(
        `UPDATE "DeliverySettlementBatch"
         SET status = 'transfer_done',
             asaas_transfer_id = $2,
             notes = COALESCE(notes, '') || $3,
             "updatedAt" = NOW()
         WHERE id = $1`,
        [
          b.id,
          tid,
          ` transfer_as_${new Date().toISOString()}`,
        ]
      );

      await client.query(
        `UPDATE "DeliverySettlementLedger"
         SET settlement_status = 'settled',
             "updatedAt" = NOW()
         WHERE settlement_batch_id = $1`,
        [b.id]
      );

      return { asaasTransferId: tid };
    });
  }

  /**
   * Consulta Asaas GET `/transfers/:id` para lotes já marcados transfer_done.
   * Se o Asaas reportar falha, move o lote para `transfer_failed` (ledger continua `settled` — tratamento operacional manual).
   */
  async reconcileExecutedTransfers(limit = 60): Promise<{
    scanned: number;
    flaggedFailed: number;
    failures: Array<{ batchId: string; error: string }>;
  }> {
    if (!isAsaasConfigured()) {
      throw new Error('ASAAS_API_KEY não configurada');
    }
    const lim = Math.min(Math.max(limit, 1), 200);
    const rows = await query<DeliverySettlementBatchRow>(
      `SELECT * FROM "DeliverySettlementBatch"
       WHERE status = 'transfer_done'
         AND asaas_transfer_id IS NOT NULL
         AND asaas_transfer_id != ''
       ORDER BY "updatedAt" DESC
       LIMIT $1`,
      [lim]
    );

    let flaggedFailed = 0;
    const failures: Array<{ batchId: string; error: string }> = [];

    for (const b of rows) {
      const tid = b.asaas_transfer_id?.trim();
      if (!tid) continue;
      try {
        const remote = (await asaasGetTransfer(tid)) as Record<string, unknown>;
        const st = String(remote.status ?? '').toUpperCase();
        const failLike =
          st === 'FAILED' ||
          st === 'CANCELLED' ||
          st === 'DENIED' ||
          st === 'REFUSED' ||
          remote.failReason != null;
        if (failLike) {
          const note = ` reconcile_transfer_fail_${st}_${new Date().toISOString()}`;
          await execute(
            `UPDATE "DeliverySettlementBatch"
             SET status = 'transfer_failed',
                 notes = COALESCE(notes, '') || $2,
                 "updatedAt" = NOW()
             WHERE id = $1 AND status = 'transfer_done'`,
            [b.id, note]
          );
          flaggedFailed += 1;
        }
      } catch (e: any) {
        failures.push({
          batchId: b.id,
          error: e?.message || String(e),
        });
      }
    }

    return { scanned: rows.length, flaggedFailed, failures };
  }
}
