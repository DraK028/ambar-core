# syntax=docker/dockerfile:1.7
# n8n con los flujos de Ámbar. Se construye desde la raíz del monorepo:
#   docker build -f automation/n8n/Dockerfile -t ambar-n8n .
FROM n8nio/n8n:2.40.7

USER root
COPY automation/n8n/workflows/ /opt/ambar/workflows/
COPY automation/n8n/bootstrap.sh /opt/ambar/bootstrap.sh
RUN chmod -R a-w /opt/ambar && chmod 555 /opt/ambar/bootstrap.sh
USER node

ENV GENERIC_TIMEZONE=America/Mexico_City \
    TZ=America/Mexico_City \
    # Los nodos Code verifican la firma HMAC con crypto y leen la configuración con $env.
    NODE_FUNCTION_ALLOW_BUILTIN=crypto \
    N8N_BLOCK_ENV_ACCESS_IN_NODE=false \
    N8N_RUNNERS_ENABLED=true \
    # Retención corta: las ejecuciones con error guardan payloads con montos e ids de cuentas.
    EXECUTIONS_DATA_PRUNE=true \
    EXECUTIONS_DATA_MAX_AGE=168 \
    N8N_DIAGNOSTICS_ENABLED=false \
    N8N_VERSION_NOTIFICATIONS_ENABLED=false \
    N8N_TEMPLATES_ENABLED=false \
    N8N_PERSONALIZATION_ENABLED=false \
    N8N_HIRING_BANNER_ENABLED=false \
    AMBAR_WORKFLOWS_DIR=/opt/ambar/workflows

EXPOSE 5678
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5678/healthz || exit 1
ENTRYPOINT ["tini", "--", "/opt/ambar/bootstrap.sh"]
