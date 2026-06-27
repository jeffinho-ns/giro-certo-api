/**
 * Migração do slug público da loja (Partner.slug) + backfill dos parceiros existentes.
 * Loja Virtual — Passo 3.
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

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

function slugify(input) {
  return (input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

async function run() {
  const client = await pool.connect();
  try {
    const sqlPath = path.join(__dirname, 'migrate-store-slug.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await client.query(sql);
    console.log('✅ Coluna Partner.slug garantida.');

    // Backfill: gera slug para parceiros sem slug, com unicidade.
    const { rows: partners } = await client.query(
      `SELECT id, name FROM "Partner" WHERE slug IS NULL OR slug = '' ORDER BY "createdAt" ASC`
    );

    const taken = new Set();
    const { rows: existing } = await client.query(
      `SELECT slug FROM "Partner" WHERE slug IS NOT NULL AND slug <> ''`
    );
    existing.forEach((r) => taken.add(r.slug));

    let updated = 0;
    for (const p of partners) {
      const root = slugify(p.name) || 'loja';
      let candidate = root;
      let n = 1;
      while (taken.has(candidate)) {
        n += 1;
        candidate = `${root}-${n}`;
      }
      taken.add(candidate);
      await client.query(`UPDATE "Partner" SET slug = $1, "updatedAt" = NOW() WHERE id = $2`, [
        candidate,
        p.id,
      ]);
      updated += 1;
    }

    console.log(`✅ Backfill de slug concluído. ${updated} parceiro(s) atualizado(s).`);
  } catch (e) {
    console.error('❌ Falha:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
