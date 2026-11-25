# bft-flow — воркер жизненного цикла БФТ на Temporal (ADR-0022). Контекст сборки — bft-flow/.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY src ./src
COPY scripts ./scripts
COPY test ./test
# Юнит-тесты reduce — в сборке; тест workflow на dev-сервере Temporal — только локально (BFT_FLOW_E2E=1).
RUN npm run build && npm test && npm prune --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim
ENV NODE_ENV=production BFT_FLOW_READY_FILE=/tmp/bft-flow-ready
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/lib ./lib
USER node
HEALTHCHECK --interval=10s --start-period=60s --retries=6 CMD test -f /tmp/bft-flow-ready
CMD ["node", "lib/worker.js"]
