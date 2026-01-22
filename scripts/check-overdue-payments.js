const { Pool } = require('pg');
require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ Erro: DATABASE_URL não está configurada');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: connectionString.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
});

/**
 * Job para verificar e atualizar status de pagamentos vencidos
 * Deve ser executado diariamente (cron job)
 */
async function checkOverduePayments() {
  const client = await pool.connect();

  try {
    console.log('🔄 Verificando pagamentos vencidos...\n');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Buscar pagamentos com status ACTIVE ou WARNING que estão vencidos
    const overduePayments = await client.query(
      `SELECT pp.*, p.id as "partnerId", p.name as "partnerName"
       FROM "PartnerPayment" pp
       JOIN "Partner" p ON p.id = pp."partnerId"
       WHERE pp.status IN ('ACTIVE', 'WARNING')
         AND pp."dueDate" IS NOT NULL
         AND pp."dueDate" < $1`,
      [today]
    );

    console.log(`📊 Encontrados ${overduePayments.rows.length} pagamentos vencidos\n`);

    let updated = 0;
    let blocked = 0;

    for (const payment of overduePayments.rows) {
      // Calcular dias de atraso
      const dueDate = new Date(payment.dueDate);
      const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));

      // Se está vencido há mais de 7 dias, bloquear
      if (daysOverdue > 7) {
        // Atualizar status para OVERDUE
        await client.query(
          `UPDATE "PartnerPayment" 
           SET status = $1, "updatedAt" = NOW()
           WHERE id = $2`,
          ['OVERDUE', payment.id]
        );

        // Bloquear parceiro
        await client.query(
          `UPDATE "Partner" 
           SET "isBlocked" = true, "updatedAt" = NOW()
           WHERE id = $1`,
          [payment.partnerId]
        );

        console.log(`🚫 Bloqueado: ${payment.partnerName} (${daysOverdue} dias de atraso)`);
        blocked++;
      } else {
        // Apenas atualizar para WARNING se ainda não estiver
        if (payment.status === 'ACTIVE') {
          await client.query(
            `UPDATE "PartnerPayment" 
             SET status = $1, "updatedAt" = NOW()
             WHERE id = $2`,
            ['WARNING', payment.id]
          );

          console.log(`⚠️  Aviso: ${payment.partnerName} (${daysOverdue} dias de atraso)`);
        }
      }

      updated++;
    }

    console.log(`\n✅ Processamento concluído:`);
    console.log(`   - Atualizados: ${updated}`);
    console.log(`   - Bloqueados: ${blocked}\n`);

    // Também verificar se há pagamentos em WARNING que devem voltar para ACTIVE
    // (se foram pagos mas o status não foi atualizado)
    const warningPayments = await client.query(
      `SELECT pp.*, p.id as "partnerId", p.name as "partnerName"
       FROM "PartnerPayment" pp
       JOIN "Partner" p ON p.id = pp."partnerId"
       WHERE pp.status = 'WARNING'
         AND pp."dueDate" IS NOT NULL
         AND pp."dueDate" >= $1`,
      [today]
    );

    if (warningPayments.rows.length > 0) {
      console.log(`📊 Encontrados ${warningPayments.rows.length} pagamentos em WARNING que podem voltar para ACTIVE\n`);

      for (const payment of warningPayments.rows) {
        await client.query(
          `UPDATE "PartnerPayment" 
           SET status = $1, "updatedAt" = NOW()
           WHERE id = $2`,
          ['ACTIVE', payment.id]
        );

        console.log(`✅ Status atualizado: ${payment.partnerName} (voltou para ACTIVE)`);
      }
    }

  } catch (error) {
    console.error('\n❌ Erro durante verificação:');
    console.error(error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

checkOverduePayments();
