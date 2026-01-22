// Usar require para importar módulos TypeScript compilados ou usar ts-node
// Por enquanto, vamos usar uma abordagem que funciona com o código TypeScript compilado
require('dotenv').config();

// Para executar este script, você precisa compilar o TypeScript primeiro
// ou usar ts-node: npx ts-node scripts/check-alerts.ts
// Por enquanto, vamos criar uma versão que funciona diretamente

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ Erro: DATABASE_URL não está configurada');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
});

async function checkAlerts() {
  const client = await pool.connect();
  
  try {
    console.log('🔔 Verificando e criando alertas automáticos...\n');
    
    // Função para gerar IDs únicos
    function generateId() {
      const timestamp = Date.now().toString(36);
      const randomPart = Math.random().toString(36).substring(2, 15);
      return `${timestamp}${randomPart}`;
    }
    
    let alertsCreated = 0;
    
    // 1. Verificar documentos expirando
    const expiringDocs = await client.query(`
      SELECT 
        cd.id, cd."userId", cd."documentType", cd."expirationDate", u.name as "userName"
      FROM "CourierDocument" cd
      INNER JOIN "User" u ON u.id = cd."userId"
      WHERE cd.status = 'APPROVED'
      AND cd."expirationDate" IS NOT NULL
      AND cd."expirationDate" <= (NOW() + INTERVAL '30 days')
      AND cd."expirationDate" > NOW()
      AND NOT EXISTS (
        SELECT 1 FROM "Alert" a
        WHERE a."userId" = cd."userId"
        AND a.type = 'DOCUMENT_EXPIRING'
        AND a."createdAt" > (NOW() - INTERVAL '1 day')
      )
    `);
    
    for (const doc of expiringDocs.rows) {
      const daysUntilExpiry = Math.ceil(
        (new Date(doc.expirationDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );
      
      await client.query(
        `INSERT INTO "Alert" (id, type, severity, title, message, "userId", "isRead", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, false, NOW())`,
        [
          generateId(),
          'DOCUMENT_EXPIRING',
          daysUntilExpiry <= 7 ? 'HIGH' : 'MEDIUM',
          `Documento expirando em ${daysUntilExpiry} dias`,
          `O documento ${doc.documentType} do entregador ${doc.userName} expira em ${daysUntilExpiry} dias (${new Date(doc.expirationDate).toLocaleDateString('pt-BR')}).`,
          doc.userId,
        ]
      );
      alertsCreated++;
    }
    
    // 2. Verificar manutenções críticas
    const criticalMaintenances = await client.query(`
      SELECT 
        ml.id, ml."userId", ml."bikeId", ml.status, ml."wearPercentage",
        u.name as "userName", b.model as "bikeModel"
      FROM "MaintenanceLog" ml
      INNER JOIN "User" u ON u.id = ml."userId"
      INNER JOIN "Bike" b ON b.id = ml."bikeId"
      WHERE (ml.status = 'CRITICO' OR ml."wearPercentage" >= 0.9)
      AND NOT EXISTS (
        SELECT 1 FROM "Alert" a
        WHERE a."userId" = ml."userId"
        AND a.type = 'MAINTENANCE_CRITICAL'
        AND a."createdAt" > (NOW() - INTERVAL '1 day')
      )
    `);
    
    for (const maintenance of criticalMaintenances.rows) {
      await client.query(
        `INSERT INTO "Alert" (id, type, severity, title, message, "userId", "isRead", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, false, NOW())`,
        [
          generateId(),
          'MAINTENANCE_CRITICAL',
          'CRITICAL',
          `Manutenção crítica: ${maintenance.bikeModel}`,
          `O veículo ${maintenance.bikeModel} do entregador ${maintenance.userName} requer manutenção urgente. Status: ${maintenance.status}, Desgaste: ${(maintenance.wearPercentage * 100).toFixed(0)}%.`,
          maintenance.userId,
        ]
      );
      alertsCreated++;
    }
    
    // 3. Verificar pagamentos atrasados
    const overduePayments = await client.query(`
      SELECT 
        pp.id, pp."partnerId", p.name as "partnerName", pp."dueDate",
        EXTRACT(DAY FROM (NOW() - pp."dueDate"))::int as "daysOverdue"
      FROM "PartnerPayment" pp
      INNER JOIN "Partner" p ON p.id = pp."partnerId"
      WHERE pp.status = 'OVERDUE'
      AND pp."dueDate" < NOW()
      AND NOT EXISTS (
        SELECT 1 FROM "Alert" a
        WHERE a."partnerId" = pp."partnerId"
        AND a.type = 'PAYMENT_OVERDUE'
        AND a."createdAt" > (NOW() - INTERVAL '1 day')
      )
    `);
    
    for (const payment of overduePayments.rows) {
      await client.query(
        `INSERT INTO "Alert" (id, type, severity, title, message, "partnerId", "isRead", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, false, NOW())`,
        [
          generateId(),
          'PAYMENT_OVERDUE',
          payment.daysOverdue > 30 ? 'CRITICAL' : 'HIGH',
          `Pagamento atrasado: ${payment.partnerName}`,
          `O parceiro ${payment.partnerName} está com pagamento atrasado há ${payment.daysOverdue} dias. Vencimento: ${new Date(payment.dueDate).toLocaleDateString('pt-BR')}.`,
          payment.partnerId,
        ]
      );
      alertsCreated++;
    }
    
    console.log(`✅ ${alertsCreated} alertas criados com sucesso!\n`);
  } catch (error) {
    console.error('❌ Erro ao verificar alertas:');
    console.error(error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

checkAlerts();
