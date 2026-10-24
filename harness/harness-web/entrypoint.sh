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
PROFILE_DST="${DSH_HOME}/profiles/web"
if [ ! -x "${PROFILE_DST}/node_modules/.bin/dsh" ]; then
  echo "[entrypoint] сею профиль web в ${PROFILE_DST}" >&2
  mkdir -p "${PROFILE_DST}"
  cp -a "${PROFILE_SRC}/node_modules" "${PROFILE_DST}/"
  cp "${PROFILE_SRC}/profile.json" "${PROFILE_DST}/package.json"
  cp "${PROFILE_SRC}/cordis.patch.yml" "${PROFILE_DST}/cordis.patch.yml"
fi

mkdir -p /workspace

# Публикация наружу: до старта dsh, чтобы healthcheck compose не ловил отказ.
socat TCP-LISTEN:"${DSH_PORT}",fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:"${DSH_LOOP_PORT}" &

exec "${PROFILE_DST}/node_modules/.bin/dsh" web \
  --no-open \
  --host 127.0.0.1 \
  --port "${DSH_LOOP_PORT}" \
  --trusted-host "127.0.0.1:${DSH_PORT}" \
  --trusted-host "localhost:${DSH_PORT}"
