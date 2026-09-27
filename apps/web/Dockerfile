# syntax=docker/dockerfile:1.7
# Banca Web (Next.js standalone). Se construye desde la raíz del monorepo:
#   docker build -f apps/web/Dockerfile -t ambar-web .
# La misma imagen sirve para cualquier entorno: toda la configuración se lee al arrancar.

FROM node:22-alpine AS build
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json turbo.json ./
COPY packages/api-contract/package.json packages/api-contract/
COPY packages/api-client/package.json packages/api-client/
COPY packages/banking-rules/package.json packages/banking-rules/
COPY packages/events/package.json packages/events/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY services/ledger/package.json services/ledger/
COPY services/event-forwarder/package.json services/event-forwarder/
COPY services/assistant/package.json services/assistant/
RUN npm ci --workspace @ambar/web --include-workspace-root=false
COPY packages/api-contract packages/api-contract
COPY packages/api-client packages/api-client
COPY packages/banking-rules packages/banking-rules
COPY apps/web apps/web
RUN npm run build --workspace @ambar/web

FROM node:22-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -S ambar && adduser -S ambar -G ambar
COPY --from=build --chown=ambar:ambar /repo/apps/web/.next/standalone ./
COPY --from=build --chown=ambar:ambar /repo/apps/web/.next/static ./apps/web/.next/static
USER ambar
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1
CMD ["node", "apps/web/server.js"]
