#!/bin/sh
# Точка входа харнесс-контейнера.
#
# Факты dsh web 0.1.7-rc.2 (схема webserver — истина, доки мастера новее релиза):
#  1) $.host допускает только 127.0.0.1 | 0.0.0.0 — в контейнере биндим 0.0.0.0
#     (порт-маппинг compose наружу работает);
#  2) --public-url в этой версии нет: dsh печатает ссылку с 0.0.0.0 — start.sh
#     переписывает её в хостовую форму; хостовую форму допускает --trusted-host.
#
# Профиль сеется в DSH_HOME при первом старте: том /data живёт между
# рестартами (сессии, настройки), образ обновляет только пакеты профиля.
set -eu

DSH_PORT="${DSH_PORT:-3080}"
DSH_LOOP_PORT=13080   # loopback-порт dsh; наружу (0.0.0.0:${DSH_PORT}) — socat
echo "[entrypoint] dsh 127.0.0.1:${DSH_LOOP_PORT} -> 0.0.0.0:${DSH_PORT} (socat)" >&2

PROFILE_SRC="/app"
PROFILE="${DSH_PROFILE:-web}"
# dsh web жёстко стартует профиль "web" (docs: dsh --profile web web): папка
# всегда profiles/web, а вот КОНТЕНТ сида берём по DSH_PROFILE (ADR-0007).
PROFILE_DST="${DSH_HOME}/profiles/web"
SEED_MARKER="${PROFILE_DST}/.seed-marker"
need_seed() {
  [ ! -x "${PROFILE_DST}/node_modules/.bin/dsh" ] && return 0
  [ "$(cat /app/seed-marker 2>/dev/null)" != "$(cat "${SEED_MARKER}" 2>/dev/null)" ] && return 0
  return 1
}
if need_seed; then
  echo "[entrypoint] сею профиль web в ${PROFILE_DST}" >&2
  mkdir -p "${PROFILE_DST}"
  rm -rf "${PROFILE_DST}/node_modules"
  cp -a "${PROFILE_SRC}/node_modules" "${PROFILE_DST}/"
  cp "${PROFILE_SRC}/$([ "${PROFILE}" = "customer" ] && echo customer-profile.json || echo profile.json)" "${PROFILE_DST}/package.json"
  if [ "${PROFILE}" = "customer" ]; then
    cp "${PROFILE_SRC}/customer.patch.yml" "${PROFILE_DST}/cordis.patch.yml"
  else
    cp "${PROFILE_SRC}/cordis.patch.yml" "${PROFILE_DST}/cordis.patch.yml"
  fi
  cp /app/seed-marker "${SEED_MARKER}"
fi

mkdir -p /workspace

# Ключ из онбординга (US-8): пишется в /data/zai.key, включается здесь —
# после docker compose restart harness-web (подсказка онбординга).
if [ -f "${DSH_HOME}/zai.key" ]; then
  ZAI_API_KEY="$(tr -d '[:space:]' < "${DSH_HOME}/zai.key")"
  export ZAI_API_KEY
  echo "[entrypoint] ZAI_API_KEY подмешан из ${DSH_HOME}/zai.key" >&2
fi

# Публикация наружу: до старта dsh, чтобы healthcheck compose не ловил отказ.
socat TCP-LISTEN:"${DSH_PORT}",fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:"${DSH_LOOP_PORT}" &

exec "${PROFILE_DST}/node_modules/.bin/dsh" web \
  --no-open \
  --host 127.0.0.1 \
  --port "${DSH_LOOP_PORT}" \
  --trusted-host "127.0.0.1:${DSH_PORT}" \
  --trusted-host "localhost:${DSH_PORT}"
