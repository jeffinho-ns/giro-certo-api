/**
 * Backfill: pedidos da loja virtual pagos/despachados sem linha no livro de repasses.
 * Uso: npm run db:backfill:store-order-settlement
 */
require('dotenv').config();
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL não definida.');
  process.exit(1);
}

const useSsl =
  process.env.PGSSL === 'true' ||
  DATABASE_URL.includes('render.com') ||
  DATABASE_URL.includes('dpg-');

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

function roundMoney(n) {
  return Math.round(n * 100) / 100;
}

function computeSplits(subtotal, deliveryFee) {
  const platformFeeStore = roundMoney(Number(process.env.GIRO_PLATFORM_FEE_STORE_FIXED ?? 2));
  const platformFeeRider = roundMoney(Number(process.env.GIRO_PLATFORM_FEE_RIDER_PER_ORDER ?? 1));
  const customerTotal = roundMoney(subtotal + deliveryFee);
  const storeNetSnapshot = roundMoney(Math.max(0, subtotal - platformFeeStore));
  const riderNetSnapshot = roundMoney(Math.max(0, deliveryFee - platformFeeRider));
  return {
    customerTotal,
    platformFeeStore,
    platformFeeRider,
    storeNetSnapshot,
    riderNetSnapshot,
  };
}

function generateId() {
  return require('crypto').randomBytes(12).toString('hex');
}

async function run() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT
        so.id,
        so.subtotal,
        so."deliveryFee",
        so.total,
        so."asaasPaymentId",
        so."asaasCustomerId",
        so."billingType",
        so."paidAt",
        so."deliveryOrderId",
        d."riderId"
       FROM "StoreOrder" so
       INNER JOIN "DeliveryOrder" d ON d.id = so."deliveryOrderId"
       WHERE so."deliveryOrderId" IS NOT NULL
         AND so."paidAt" IS NOT NULL
         AND so.status IN ('dispatched', 'in_delivery', 'completed')
         AND NOT EXISTS (
           SELECT 1 FROM "DeliverySettlementLedger" l
           WHERE l."deliveryOrderId" = so."deliveryOrderId"
         )
       ORDER BY so."paidAt" ASC
       LIMIT 500`
    );

    let recorded = 0;
    for (const row of rows) {
      const subtotal = Number(row.subtotal ?? 0);
      const deliveryFee = Number(row.deliveryFee ?? 0);
      const splits = computeSplits(subtotal, deliveryFee);
      const customerTotal = row.total && row.total > 0 ? row.total : splits.customerTotal;
      const idempotencyKey = `store_order_${row.id}`;

      const existingPayment = await client.query(
        `SELECT id, status FROM "DeliveryPayment" WHERE "idempotencyKey" = $1`,
        [idempotencyKey]
      );

      let paymentId;
      if (existingPayment.rows[0]) {
        paymentId = existingPayment.rows[0].id;
        if (existingPayment.rows[0].status !== 'paid') {
          await client.query(
            `UPDATE "DeliveryPayment"
             SET status = 'paid', "paidAt" = COALESCE("paidAt", $2), "updatedAt" = NOW()
             WHERE id = $1`,
            [paymentId, row.paidAt ?? new Date()]
          );
        }
      } else {
        paymentId = generateId();
        await client.query(
          `INSERT INTO "DeliveryPayment" (
            id, "deliveryOrderId", status, "collectionMode",
            "customerTotal", "itemValueSnapshot", "deliveryFeeSnapshot",
            "platformFeeStore", "platformFeeRider", "storeNetSnapshot", "riderNetSnapshot",
            currency, "idempotencyKey", "asaasPaymentId", "asaasCustomerId",
            "billingTypeRequested", "paidAt", "lastWebhookEvent", "updatedAt"
          ) VALUES (
            $1, $2, 'paid', 'prepaid',
            $3, $4, $5, $6, $7, $8, $9,
            'BRL', $10, $11, $12, $13, $14, 'store_order_backfill', NOW()
          )`,
          [
            paymentId,
            row.deliveryOrderId,
            customerTotal,
            subtotal,
            deliveryFee,
            splits.platformFeeStore,
            splits.platformFeeRider,
            splits.storeNetSnapshot,
            splits.riderNetSnapshot,
            idempotencyKey,
            row.asaasPaymentId,
            row.asaasCustomerId,
            row.billingType ?? 'PIX',
            row.paidAt ?? new Date(),
          ]
        );
      }

      const ledgerExists = await client.query(
        `SELECT id FROM "DeliverySettlementLedger" WHERE "deliveryPaymentId" = $1`,
        [paymentId]
      );
      if (ledgerExists.rows[0]) continue;

      const order = await client.query(
        `SELECT id, "storeId", "riderId" FROM "DeliveryOrder" WHERE id = $1`,
        [row.deliveryOrderId]
      );
      if (!order.rows[0]) continue;

      await client.query(
        `INSERT INTO "DeliverySettlementLedger" (
          id, "deliveryPaymentId", "deliveryOrderId", "storeId", "riderUserId",
          "storeNetAmount", "riderNetAmount", "platformFeeStore", "platformFeeRider",
          "customerTotal", currency, settlement_status, "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'BRL', 'pending', NOW(), NOW()
        )`,
        [
          generateId(),
          paymentId,
          order.rows[0].id,
          order.rows[0].storeId,
          order.rows[0].riderId,
          splits.storeNetSnapshot,
          splits.riderNetSnapshot,
          splits.platformFeeStore,
          splits.platformFeeRider,
          customerTotal,
        ]
      );
      recorded += 1;
      console.log(`✅ StoreOrder ${row.id.slice(-8)} → ledger`);
    }

    console.log(`\nConcluído: ${recorded}/${rows.length} pedido(s) registrado(s) no livro.`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
