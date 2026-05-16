#!/usr/bin/env bash
# Exemplo para Cron (Render, GitHub Actions, etc.) — ajuste API_BASE e GIRO_CRON_SECRET.
set -euo pipefail

API_BASE="${API_BASE:-https://giro-certo-api.onrender.com}"
SECRET="${GIRO_CRON_SECRET:?defina GIRO_CRON_SECRET}"

curl -sf -X POST "${API_BASE}/api/settlement/reconcile-scheduled" \
  -H "Content-Type: application/json" \
  -H "x-giro-cron-secret: ${SECRET}" \
  -d '{"payments":true,"transfers":true,"paymentLimit":80,"transferLimit":60}'

echo ""
echo "reconcile-scheduled OK"

# Compor lotes (ex.: 1x/dia num job separado):
# curl -sf -X POST "${API_BASE}/api/settlement/batches/compose-scheduled" \
#   -H "Content-Type: application/json" \
#   -H "x-giro-cron-secret: ${SECRET}" \
#   -d '{}'
