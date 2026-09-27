# syntax=docker/dockerfile:1.7
# Imagen del servicio Ledger para ECS Fargate. Se construye desde la raíz del monorepo:
#   docker build -f services/ledger/Dockerfile -t ambar-ledger .

FROM node:26-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json turbo.json ./
# Todos los package.json del monorepo: npm ci valida el lockfile completo,
# pero solo instala lo que necesita este workspace.
COPY packages/api-contract/package.json packages/api-contract/
COPY packages/api-client/package.json packages/api-client/
COPY packages/banking-rules/package.json packages/banking-rules/
COPY packages/events/package.json packages/events/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY services/ledger/package.json services/ledger/
COPY services/event-forwarder/package.json services/event-forwarder/
COPY services/assistant/package.json services/assistant/
RUN npm ci --workspace @ambar/ledger --include-workspace-root=false
COPY packages/api-contract packages/api-contract
COPY packages/events packages/events
COPY services/ledger services/ledger
# @ambar/events es un workspace (symlink en node_modules): se reemplaza por una copia real
# para que la imagen final no dependa de la estructura del monorepo.
RUN npm run build --workspace @ambar/ledger \
 && npm prune --omit=dev --workspace @ambar/ledger \
 && rm node_modules/@ambar/events && cp -r packages/events node_modules/@ambar/events

FROM node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Usuario sin privilegios; el sistema de archivos puede montarse como solo lectura en ECS.
RUN addgroup -S ambar && adduser -S ambar -G ambar
COPY --from=build --chown=ambar:ambar /repo/node_modules ./node_modules
COPY --from=build --chown=ambar:ambar /repo/services/ledger/package.json ./package.json
COPY --from=build --chown=ambar:ambar /repo/services/ledger/dist ./dist
COPY --from=build --chown=ambar:ambar /repo/services/ledger/db ./db
# CAs de RDS para validar el certificado de Aurora (DB_SSL_CA_FILE).
ADD --chown=ambar:ambar --chmod=444 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/certs/rds-global-bundle.pem
USER ambar
# 3000: API. 3001: health del relay (mismo contenedor, comando node dist/relay/main.js).
EXPOSE 3000 3001
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/main.js"]
