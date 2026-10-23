#!/bin/sh
# Точка входа харнесс-контейнера.
#
# Два факта dsh web, из которых вырос этот скрипт (docs/cli-help.md апстрима):
#  1) --host отвергает wildcard-адреса — биндим конкретный IP контейнера,
#     иначе порт-маппинг compose наружу не работает;
#  2) --public-url не меняет слушающий адрес, а только то, что dsh печатает и
#     чем доверяет /api-забор (--trusted-host). Даём хостовую форму ссылки.
#
# Профиль сеется в DSH_HOME при первом старте: том /data живёт между
# рестартами (сессии, настройки), образ обновляет только пакеты профиля.
set -eu

DSH_PORT="${DSH_PORT:-3080}"
PUBLIC_URL="${PUBLIC_URL:-http://127.0.0.1:${DSH_PORT}}"

IP="$(hostname -i | awk '{print $1}')"
echo "[entrypoint] bind ${IP}:${DSH_PORT}, public ${PUBLIC_URL}" >&2

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

exec "${PROFILE_DST}/node_modules/.bin/dsh" web \
  --no-open \
  --host "${IP}" \
  --port "${DSH_PORT}" \
  --public-url "${PUBLIC_URL}" \
  --trusted-host "127.0.0.1:${DSH_PORT}" \
  --trusted-host "localhost:${DSH_PORT}"
