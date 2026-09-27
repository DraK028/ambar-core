# syntax=docker/dockerfile:1.7
# Asistente financiero. Se construye desde la raíz del monorepo:
#   docker build -f services/assistant/Dockerfile -t ambar-assistant .
FROM node:26-alpine AS build
WORKDIR /repo
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
RUN npm ci --workspace @ambar/assistant --include-workspace-root=false
COPY packages/api-contract packages/api-contract
COPY packages/api-client packages/api-client
COPY services/assistant services/assistant
RUN npm run build --workspace @ambar/assistant \
 && npm prune --omit=dev --workspace @ambar/assistant

FROM node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S ambar && adduser -S ambar -G ambar
COPY --from=build --chown=ambar:ambar /repo/node_modules ./node_modules
COPY --from=build --chown=ambar:ambar /repo/services/assistant/package.json ./package.json
COPY --from=build --chown=ambar:ambar /repo/services/assistant/dist ./dist
USER ambar
EXPOSE 3002
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3002/health || exit 1
CMD ["node", "dist/main.js"]
