#!/bin/sh
# Arranque de n8n con los flujos del repositorio ("workflows como código").
#
#   1. Crea la credencial client_credentials hacia el core a partir de variables de entorno
#      (el secreto nunca se versiona; en AWS llega desde Secrets Manager).
#   2. Importa los flujos de workflows/ con ids fijos: lo que está en Git es lo que corre.
#      Un cambio hecho a mano en la UI se pierde al reiniciar; los cambios van por pull request.
#   3. Publica los flujos con disparador y arranca n8n.
set -eu

: "${AMBAR_CORE_URL:?Define AMBAR_CORE_URL (URL interna del Ledger)}"
: "${AMBAR_CORE_TOKEN_URL:?Define AMBAR_CORE_TOKEN_URL (endpoint /oauth2/token de Cognito)}"
: "${AMBAR_CORE_CLIENT_ID:?Define AMBAR_CORE_CLIENT_ID}"
: "${AMBAR_CORE_CLIENT_SECRET:?Define AMBAR_CORE_CLIENT_SECRET}"
: "${WEBHOOK_SIGNING_SECRET:?Define WEBHOOK_SIGNING_SECRET (mismo secreto que usa el forwarder)}"
: "${N8N_ENCRYPTION_KEY:?Define N8N_ENCRYPTION_KEY}"

WORKFLOWS_DIR="${AMBAR_WORKFLOWS_DIR:-/opt/ambar/workflows}"
SCOPES="${AMBAR_CORE_SCOPES:-ambar-api/internal.notify ambar-api/internal.fraud ambar-api/internal.reconcile}"
# El flujo de errores también se publica: n8n 2.x solo ejecuta flujos de error publicados.
PUBLISH="AmbarOnboarding1 AmbarMovimientos AmbarAlertaFraud AmbarFraudeResp1 AmbarConciliacio AmbarErrores0001"

CREDS="$(mktemp)"
trap 'rm -f "$CREDS"' EXIT
SCOPES="$SCOPES" node -e '
  const e = process.env;
  process.stdout.write(JSON.stringify([{
    id: "AmbarCoreM2M0001",
    name: "Ámbar core (client credentials)",
    type: "oAuth2Api",
    data: {
      grantType: "clientCredentials",
      accessTokenUrl: e.AMBAR_CORE_TOKEN_URL,
      clientId: e.AMBAR_CORE_CLIENT_ID,
      clientSecret: e.AMBAR_CORE_CLIENT_SECRET,
      scope: e.SCOPES,
      authentication: "header",
    },
  }]));
' > "$CREDS"

n8n import:credentials --input="$CREDS"
rm -f "$CREDS"
# La credencial ya quedó cifrada en la base de n8n (N8N_ENCRYPTION_KEY). El secreto se quita del
# entorno para que un nodo Code no pueda leerlo con $env.
unset AMBAR_CORE_CLIENT_SECRET
n8n import:workflow --separate --input="$WORKFLOWS_DIR"
for id in $PUBLISH; do
  n8n publish:workflow --id="$id"
done

exec n8n start
