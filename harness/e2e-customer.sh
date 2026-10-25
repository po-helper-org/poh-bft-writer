#!/usr/bin/env bash
# E2E HowToDemo-1 портала заказчика (rev5): открыл → обращение → ссылка < 1с.
#   ./e2e-customer.sh        # из harness/, стек поднят
# Playwright бежит в контейнере (node на хосте не нужен); --network host —
# чтобы 127.0.0.1:3080/3456 были те же адреса, что видит заказчик.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.orbstack/bin:$PATH"

# Пароль трекера — для проверки задачи в Vikunja (в вывод не попадает).
TRACKER_PASSWORD="$(grep -E '^TRACKER_ADMIN_PASSWORD=' .env | cut -d= -f2- || true)"

curl -s -o /dev/null -w "▸ портал: %{http_code}\n" http://127.0.0.1:3080/
PW_VERSION="$(sed -n 's/.*"version": "\(.*\)".*/\1/p' ../customer-form/node_modules/@playwright/test/package.json)"
docker run --rm --network host --ipc host \
  -e TRACKER_PASSWORD="$TRACKER_PASSWORD" -e CI=1 \
  -v "$PWD/../customer-form:/work" -w /work \
  "mcr.microsoft.com/playwright:v${PW_VERSION}-noble" \
  npx playwright test "$@"
