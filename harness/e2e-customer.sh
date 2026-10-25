#!/usr/bin/env bash
# E2E портала заказчика (HowToDemo заказчика п.1–10).
#   ./e2e-customer.sh        # из harness/, стек поднят
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

wait_portal() {
  for _ in $(seq 1 60); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3080/)" = 200 ] && return 0
    sleep 2
  done
  echo "портал не поднялся" >&2; return 1
}

restore() {
  docker compose exec -T customer-web rm -f /data/override.patch.yml >/dev/null 2>&1 || true
  docker compose restart customer-web >/dev/null 2>&1 || true
  docker rm -f llm-double >/dev/null 2>&1 || true
  wait_portal && echo "▸ портал возвращён на модель профиля"
}
[ "${E2E_KEEP:-}" = 1 ] || trap restore EXIT

echo "▸ модель-двойник :8799"
docker rm -f llm-double >/dev/null 2>&1 || true
docker run -d --name llm-double --network host -v "$E2E_DIR:/e2e:ro" "$NODE_IMAGE" node /e2e/llm-double.mjs >/dev/null
docker compose cp "$E2E_DIR/llm-double.patch.yml" customer-web:/data/override.patch.yml >/dev/null
docker compose restart customer-web >/dev/null
wait_portal

# Пароль трекера — для проверки задачи в Vikunja (в вывод не попадает).
TRACKER_PASSWORD="$(grep -E '^TRACKER_ADMIN_PASSWORD=' .env | cut -d= -f2- || true)"
PW_VERSION="$(sed -n 's/.*"version": "\(.*\)".*/\1/p' ../customer-form/node_modules/@playwright/test/package.json)"
status=0
docker run --rm --network host --ipc host \
  -e TRACKER_PASSWORD="$TRACKER_PASSWORD" -e LLM_DOUBLE=1 -e CI=1 \
  -v "$PWD/../customer-form:/work" -w /work \
  "mcr.microsoft.com/playwright:v${PW_VERSION}-noble" \
  npx playwright test "$@" || status=$?
# voice-terms.spec: что термины диалога дошли до распознавателя, видно только в логе узла.
docker compose logs customer-web --since 10m 2>/dev/null | grep -o '\[speech-ru\] термины диалога: .*' | tail -1 | sed 's/^/▸ /' || true
exit "$status"
