#!/bin/sh
# n8n local contra el Ledger y el servidor de tokens de desarrollo (sin Docker).
# Requiere Node 24 y n8n 2.40 instalados (npm i -g n8n@2.40.7) y las mismas variables que el Ledger.
#
#   LOCAL_JWT_SECRET=... N8N_CLIENT_SECRET=... WEBHOOK_SIGNING_SECRET=... sh automation/n8n/run-local.sh
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"

: "${N8N_CLIENT_SECRET:?Define N8N_CLIENT_SECRET (el mismo que usa tools/dev-auth-server.mjs)}"
: "${WEBHOOK_SIGNING_SECRET:?Define WEBHOOK_SIGNING_SECRET (el mismo que usa el relay)}"

export N8N_USER_FOLDER="${N8N_USER_FOLDER:-$HERE/.n8n-local}"
export N8N_ENCRYPTION_KEY="${N8N_ENCRYPTION_KEY:-solo-local-no-usar-en-aws-000000}"
export N8N_LISTEN_ADDRESS=127.0.0.1 N8N_PORT="${N8N_PORT:-5678}"
export GENERIC_TIMEZONE=America/Mexico_City NODE_FUNCTION_ALLOW_BUILTIN=crypto N8N_BLOCK_ENV_ACCESS_IN_NODE=false
export N8N_DIAGNOSTICS_ENABLED=false N8N_VERSION_NOTIFICATIONS_ENABLED=false N8N_TEMPLATES_ENABLED=false
export AMBAR_CORE_URL="${AMBAR_CORE_URL:-http://127.0.0.1:3000}"
export AMBAR_CORE_TOKEN_URL="${AMBAR_CORE_TOKEN_URL:-http://127.0.0.1:8787/token}"
export AMBAR_CORE_CLIENT_ID="${AMBAR_CORE_CLIENT_ID:-n8n-local}"
export AMBAR_CORE_CLIENT_SECRET="$N8N_CLIENT_SECRET"
export PUSH_ENABLED="${PUSH_ENABLED:-false}"
export AMBAR_WORKFLOWS_DIR="$HERE/workflows"

exec sh "$HERE/bootstrap.sh"
