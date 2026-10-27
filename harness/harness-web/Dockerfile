# syntax=docker/dockerfile:1
# Харнесс-контейнер: dsh web + poh-bft-plugin + скиллы + провайдер z.ai.
# Контекст сборки — КОРЕНЬ репозитория (см. compose: context: ..).
#
#   docker build -f harness/harness-web/Dockerfile -t poh-harness-web:local .
#
# Три стадии: сборка плагина (pnpm) → профиль (npm, пин версии dsh) → рантайм.
FROM node:22-bookworm-slim AS plugins
WORKDIR /src
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY plugin/package.json plugin/pnpm-lock.yaml plugin/tsconfig*.json plugin/tsdown.config.ts ./plugin/
COPY plugin/src ./plugin/src
COPY plugin/cordis.patch.yml ./plugin/
RUN cd plugin && pnpm install --frozen-lockfile && pnpm build
# customer-form (ADR-0007): npm — lock-файла нет
COPY customer-form/package.json customer-form/tsconfig*.json customer-form/tsdown.config.ts ./customer-form/
COPY customer-form/src ./customer-form/src
COPY customer-form/cordis.patch.yml ./customer-form/
RUN cd customer-form && npm install --no-audit --no-fund && npm run build
# bft-manager (ADR-0009): «Управление БФТ» для PO поверх API Vikunja
COPY bft-manager/package.json bft-manager/tsconfig*.json bft-manager/tsdown.config.ts bft-manager/cordis.patch.yml ./bft-manager/
COPY bft-manager/src ./bft-manager/src
COPY bft-manager/test ./bft-manager/test
RUN cd bft-manager && npm install --no-audit --no-fund && npm run build && npm test
# speech-ru (ADR-0008): распознавание русской речи для голосового ввода
COPY speech-ru/package.json speech-ru/tsconfig.json speech-ru/cordis.patch.yml ./speech-ru/
COPY speech-ru/src ./speech-ru/src
COPY speech-ru/test ./speech-ru/test
RUN cd speech-ru && npm install --no-audit --no-fund && npm test

FROM node:22-bookworm-slim AS profile
ARG DSH_VERSION=0.1.7-rc.2
WORKDIR /seed
COPY harness/profile/package.json.in ./package.json.in
COPY --from=plugins /src/plugin ./plugin
COPY --from=plugins /src/customer-form ./customer-form
COPY --from=plugins /src/speech-ru ./speech-ru
COPY --from=plugins /src/bft-manager ./bft-manager
# npm для file:-зависимостей ставит СИМЛИНК (node_modules/poh-bft-plugin -> ../plugin).
# Заменяем его на реальную копию и удаляем источник: бандл живёт в node_modules
# самодостаточно (files-пакета хватает: lib + cordis.patch.yml).
COPY harness/profile/customer.json.in ./customer.json.in
RUN sed "s/__DSH_VERSION__/${DSH_VERSION}/g" package.json.in > package.json \
 && sed "s/__DSH_VERSION__/${DSH_VERSION}/g" customer.json.in > customer.json \
 && npm install --omit=dev --no-audit --no-fund \
 && rm -rf node_modules/poh-bft-plugin node_modules/customer-form node_modules/speech-ru node_modules/bft-manager \
 && cp -R plugin node_modules/poh-bft-plugin \
 && cp -R customer-form node_modules/customer-form \
 && cp -R speech-ru node_modules/speech-ru \
 && cp -R bft-manager node_modules/bft-manager \
 && node -e "const p=require('./node_modules/poh-bft-plugin/package.json'); if(!p.exports || !p.exports['./client']) process.exit(1)" \
 && node -e "const c=require('./node_modules/customer-form/package.json'); if(!c.exports || !c.exports['./client']) process.exit(1)" \
 && node -e "const b=require('./node_modules/bft-manager/package.json'); if(!b.exports || !b.exports['./client']) process.exit(1)" \
 && rm -rf plugin customer-form speech-ru bft-manager node_modules/poh-bft-plugin/node_modules node_modules/customer-form/node_modules node_modules/speech-ru/node_modules node_modules/bft-manager/node_modules \
 && npm cache clean --force

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production DSH_HOME=/data
# socat: dsh сознательно отказывается биндить 0.0.0.0 (RCE-безопасность CLI),
# поэтому он слушает loopback-КОНТЕЙНЕРА, а наружу (внутрь compose-сети)
# публикует socat. Публикация наружу хоста — по-прежнему HARNESS_BIND
# (127.0.0.1 по умолчанию): конверт безопасности тот же, что у нативного dsh.
RUN apt-get update && apt-get install -y --no-install-recommends socat \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# dsh-CLI из профиля: один пин на весь набор @deepseek-ai/dsh-* (ADR-0002).
COPY --from=profile /seed/node_modules ./node_modules
# Открытый доступ (без кода/токена, rev5): isAuthenticated всегда true.
# Контур безопасности — публикация портов только на 127.0.0.1/LAN хоста.
RUN grep -q 'isAuthenticated(request) {' /app/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js \
 && sed -i 's|isAuthenticated(request) {|isAuthenticated(request) { return true;|' /app/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js \
 && echo "no-auth: patched"
COPY --from=profile /seed/package.json ./profile.json
COPY --from=profile /seed/customer.json ./customer-profile.json
COPY harness/profile/cordis.patch.yml ./cordis.patch.yml
COPY harness/profile/customer.patch.yml ./customer.patch.yml
COPY harness/harness-web/entrypoint.sh /entrypoint.sh
# Маркер сида: меняется на каждой сборке — entrypoint перезасеивает профиль
# в /data, иначе том со старым node_modules переживал бы обновления образа.
RUN echo "seed-$(date +%s)-$RANDOM" > /app/seed-marker
# Скиллы и команды — в образ (обновление = пересборка, как и профиль).
COPY skills /opt/bft-skills
RUN chmod +x /entrypoint.sh && useradd -m -u 10001 dsh \
 && mkdir -p /data /workspace && chown -R dsh:dsh /data /workspace
USER dsh
VOLUME ["/data", "/workspace"]
EXPOSE 3080
ENTRYPOINT ["/entrypoint.sh"]
