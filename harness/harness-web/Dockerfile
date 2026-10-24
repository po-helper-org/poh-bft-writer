# syntax=docker/dockerfile:1
# Харнесс-контейнер: dsh web + poh-bft-plugin + скиллы + провайдер z.ai.
# Контекст сборки — КОРЕНЬ репозитория (см. compose: context: ..).
#
#   docker build -f harness/harness-web/Dockerfile -t poh-harness-web:local .
#
# Три стадии: сборка плагина (pnpm) → профиль (npm, пин версии dsh) → рантайм.
FROM node:22-bookworm-slim AS plugin
WORKDIR /src
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY plugin/package.json plugin/pnpm-lock.yaml plugin/tsconfig*.json plugin/tsdown.config.ts ./plugin/
COPY plugin/src ./plugin/src
COPY plugin/cordis.patch.yml ./plugin/
RUN cd plugin && pnpm install --frozen-lockfile && pnpm build

FROM node:22-bookworm-slim AS profile
ARG DSH_VERSION=0.1.7-rc.2
WORKDIR /seed
COPY harness/profile/package.json.in ./package.json.in
COPY --from=plugin /src/plugin ./plugin
# npm для file:-зависимостей ставит СИМЛИНК (node_modules/poh-bft-plugin -> ../plugin).
# Заменяем его на реальную копию и удаляем источник: бандл живёт в node_modules
# самодостаточно (files-пакета хватает: lib + cordis.patch.yml).
RUN sed "s/__DSH_VERSION__/${DSH_VERSION}/g" package.json.in > package.json \
 && npm install --omit=dev --no-audit --no-fund \
 && rm -rf node_modules/poh-bft-plugin \
 && cp -R plugin node_modules/poh-bft-plugin \
 && rm -rf plugin node_modules/poh-bft-plugin/node_modules \
 && node -e "const p=require('./node_modules/poh-bft-plugin/package.json'); if(!p.exports || !p.exports['./client']) process.exit(1)" \
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
COPY --from=profile /seed/package.json ./profile.json
COPY harness/profile/cordis.patch.yml ./cordis.patch.yml
COPY harness/harness-web/entrypoint.sh /entrypoint.sh
# Скиллы и команды — в образ (обновление = пересборка, как и профиль).
COPY skills /opt/bft-skills
RUN chmod +x /entrypoint.sh && useradd -m -u 10001 dsh \
 && mkdir -p /data /workspace && chown -R dsh:dsh /data /workspace
USER dsh
VOLUME ["/data", "/workspace"]
EXPOSE 3080
ENTRYPOINT ["/entrypoint.sh"]
