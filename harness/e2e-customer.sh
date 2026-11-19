#!/usr/bin/env bash
# E2E портала заказчика (HowToDemo заказчика п.1–10).
#   ./e2e-customer.sh        # из harness/, стек поднят
#   PORTAL_URL=http://127.0.0.1:3090/bft ./e2e-customer.sh   # портал под префиксом
#     (эмулятор прода: docker-compose.subpath.yml, без «/» на конце)
#   COMPOSE_PROJECT_NAME=poh-bft-x COMPOSE_FILE=docker-compose.yml:over.yml \
#   PORTAL_PORT=3280 TRACKER_API=http://127.0.0.1:3656/api/v1 ./e2e-customer.sh
#     # проверочный стек на своих портах (боевой 3080 не трогается)
#
# Модель — двойник (customer-form/e2e/llm-double.mjs): путь заказчика проверяется
# без внешнего ключа и квоты. Раннер поднимает двойника, подкладывает оверлей
# в том портала и по выходу ВСЕГДА возвращает портал на модель профиля (zai).
# Playwright бежит в контейнере (node на хосте не нужен); --network host —
# чтобы 127.0.0.1:3080/3456 были те же адреса, что видит заказчик.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.orbstack/bin:$PATH"
E2E_DIR="$PWD/../customer-form/e2e"
NODE_IMAGE=node:22-bookworm-slim
PORTAL_PORT="${PORTAL_PORT:-3080}"

wait_portal() {
  for _ in $(seq 1 60); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORTAL_PORT/")" = 200 ] && return 0
    sleep 2
  done
  echo "портал не поднялся" >&2; return 1
}

restore() {
  docker compose exec -T customer-web rm -f /data/override.patch.yml /data/e2e-hooks >/dev/null 2>&1 || true
  docker compose restart customer-web >/dev/null 2>&1 || true
  docker rm -f llm-double sources-double >/dev/null 2>&1 || true
  wait_portal && echo "▸ портал возвращён на модель профиля"
}
[ "${E2E_KEEP:-}" = 1 ] || trap restore EXIT

echo "▸ модель-двойник :8799"
docker rm -f llm-double >/dev/null 2>&1 || true
docker run -d --name llm-double --network host -v "$E2E_DIR:/e2e:ro" "$NODE_IMAGE" node /e2e/llm-double.mjs >/dev/null
# Шлюз источников — двойник (ADR-0019): поиск документов Confluence в чате, без корпоративного Confluence.
echo "▸ шлюз источников-двойник :8798"
docker rm -f sources-double >/dev/null 2>&1 || true
docker run -d --name sources-double --network host -v "$E2E_DIR:/e2e:ro" "$NODE_IMAGE" node /e2e/sources-double.mjs >/dev/null
docker compose cp "$E2E_DIR/llm-double.patch.yml" customer-web:/data/override.patch.yml >/dev/null
# Сбои трекера по заказу (e2e/tracker-recovery.spec.ts) — только на время прогона.
docker compose exec -T customer-web touch /data/e2e-hooks
docker compose restart customer-web >/dev/null
wait_portal

# Пароль трекера — для проверки задачи в Vikunja (в вывод не попадает).
TRACKER_PASSWORD="$(grep -E '^TRACKER_ADMIN_PASSWORD=' .env | cut -d= -f2- || true)"
# Пароль администратора портала — для admin-settings.spec (в вывод не попадает).
ADMIN_PASSWORD="$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2- || true)"
PW_VERSION="$(sed -n 's/.*"version": "\(.*\)".*/\1/p' ../customer-form/node_modules/@playwright/test/package.json)"
# Адрес портала для спеков (PORTAL_URL и CUSTOMER_URL — одно и то же); пусто — 127.0.0.1:3080.
PORTAL_URL="${PORTAL_URL:-http://127.0.0.1:$PORTAL_PORT}"
status=0
docker run --rm --network host --ipc host \
  -e TRACKER_PASSWORD="$TRACKER_PASSWORD" -e ADMIN_PASSWORD="$ADMIN_PASSWORD" -e LLM_DOUBLE=1 -e CI=1 \
  -e PORTAL_URL="${PORTAL_URL%/}" -e CUSTOMER_URL="${PORTAL_URL%/}" ${TRACKER_API:+-e TRACKER_API="$TRACKER_API"} \
  -v "$PWD/../customer-form:/work" -w /work \
  "mcr.microsoft.com/playwright:v${PW_VERSION}-noble" \
  npx playwright test "$@" || status=$?
# voice-terms.spec: что термины диалога дошли до распознавателя, видно только в логе узла.
docker compose logs customer-web --since 10m 2>/dev/null | grep -o '\[speech-ru\] термины диалога: .*' | tail -1 | sed 's/^/▸ /' || true
exit "$status"
