#!/usr/bin/env node
/**
 * Verifica se o Firebase Storage está configurado na API.
 * Uso: node scripts/check-firebase.js
 */

require('dotenv').config();

const hasBucket = !!process.env.FIREBASE_STORAGE_BUCKET;
const hasIndividual = !!(
  process.env.FIREBASE_ADMIN_PROJECT_ID &&
  process.env.FIREBASE_ADMIN_CLIENT_EMAIL &&
  process.env.FIREBASE_ADMIN_PRIVATE_KEY
);
const hasBase64 = !!process.env.FIREBASE_ADMIN_CREDENTIALS_JSON_BASE64;
const firebaseOk = hasBucket && (hasIndividual || hasBase64);

console.log('=== Firebase Storage (giro-certo-api) ===\n');
console.log('FIREBASE_STORAGE_BUCKET:', hasBucket ? '✓' : '✗ (não definido)');
console.log('Credenciais (variáveis individuais):', hasIndividual ? '✓' : '✗');
console.log('Credenciais (FIREBASE_ADMIN_CREDENTIALS_JSON_BASE64):', hasBase64 ? '✓' : '✗');
console.log('\nFirebase configurado:', firebaseOk ? '✓ SIM' : '✗ NÃO');
if (!firebaseOk) {
  console.log('\nSem Firebase, a API usa a tabela Image local.');
  console.log('Para Firebase: configure as variáveis em .env (ver FIREBASE_IMAGENS.md)');
}
