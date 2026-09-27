#!/bin/sh
# E2E de la app en un emulador de Android con Maestro, contra el stack local:
#   Postgres + Ledger (npm run dev en services/ledger) + tools/dev-auth-server.mjs
# Requisitos: emulador con huella registrada (Ajustes → Seguridad), Maestro, adb, y un
# build de desarrollo instalado (npx expo run:android) con EXPO_PUBLIC_AUTH_MODE=local.
set -eu

: "${LOCAL_JWT_SECRET:?Define LOCAL_JWT_SECRET (el del Ledger)}"
LEDGER_URL="${LEDGER_URL:-http://localhost:3000}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/../../.."

adb reverse tcp:3000 tcp:3000
adb reverse tcp:8787 tcp:8787

# Cuentas y saldo de prueba: el usuario de cada flujo y una cuenta destino conocida.
QA_TOKEN=$(cd "$ROOT/services/ledger" && npm run -s token -- qa-bot "qa.write")
for SUB in e2e-sinbio e2e-conbio; do
  TOKEN=$(cd "$ROOT/services/ledger" && npm run -s token -- "$SUB" "accounts.write")
  ACCOUNT=$(curl -fsS -X POST "$LEDGER_URL/v1/accounts" -H "Authorization: Bearer $TOKEN" | sed -E 's/.*"id":"([^"]+)".*/\1/')
  curl -fsS -X POST "$LEDGER_URL/v1/qa/deposits" -H "Authorization: Bearer $QA_TOKEN" \
    -H "Idempotency-Key: $(uuidgen | tr 'A-Z' 'a-z')" -H 'Content-Type: application/json' \
    -d "{\"account_id\":\"$ACCOUNT\",\"amount\":2000000,\"concept\":\"Fondeo E2E\"}" >/dev/null
done

DEST_TOKEN=$(cd "$ROOT/services/ledger" && npm run -s token -- "e2e-destino-$(date +%s)" "accounts.write")
DEST_CLABE=$(curl -fsS -X POST "$LEDGER_URL/v1/accounts" -H "Authorization: Bearer $DEST_TOKEN" | sed -E 's/.*"clabe":"([0-9]{18})".*/\1/')
echo "Cuenta destino: $DEST_CLABE"

maestro test -e DEST_CLABE="$DEST_CLABE" "$HERE/sin-biometria.yaml"

# Mientras corre el flujo con biometría, "toca" el sensor cada 2 s: el emulador acepta la
# huella registrada cuando aparece el diálogo del sistema.
( while true; do adb -e emu finger touch 1 >/dev/null 2>&1; sleep 2; done ) &
TOUCHER=$!
trap 'kill $TOUCHER 2>/dev/null' EXIT
maestro test -e DEST_CLABE="$DEST_CLABE" "$HERE/con-biometria.yaml"
