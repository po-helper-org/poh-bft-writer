#!/usr/bin/env bash
# Живой E2E «Отправить в Confluence» (ADR-0028, HOWTODEMO-confluence.md) — на сервере, без sudo:
#   bash ~/<DEPLOY_DIR>/harness/e2e-confluence-publish.sh <sessionId> [<ссылка тестового родителя>] [--publish]
# Без ссылки — шаги 1–3 (вкладка, ТОП-5, поиск) и проверка «не настроено», ничего не публикует.
# С ссылкой и --publish — отправка подстраницей ЭТОЙ страницы (только тестовое место!), повтор.
# Playwright в контейнере (--network host) на 127.0.0.1:3082. Итог — .e2e-live/confluence-<время>/.
set -euo pipefail
HARNESS=$(cd "$(dirname "$0")" && pwd)
PORTAL_DIR=$(cd "$HARNESS/.." && pwd)
export PATH="$HOME/.orbstack/bin:$PATH"
PORTAL_URL=${PORTAL_URL:-http://127.0.0.1:3082}
SESSION=${1:?нужна сессия заявки с готовым полным БФТ}
PARENT=${2:-}
PUBLISH=0; [ "${3:-}" = "--publish" ] && PUBLISH=1
PW_VERSION=${PW_VERSION:-1.64.1}
IMAGE=mcr.microsoft.com/playwright:v$PW_VERSION-noble
OUT=$PORTAL_DIR/.e2e-live/confluence-$(date +%Y%m%d-%H%M%S)
mkdir -p "$OUT"
docker image inspect "$IMAGE" > /dev/null 2>&1 || docker pull -q "$IMAGE" > /dev/null
echo "▸ отправка в Confluence: $PORTAL_URL, сессия ${SESSION:0:8}…, публикация: $PUBLISH → $OUT"
docker run --rm --network host --ipc host \
  -e PORTAL_URL="$PORTAL_URL" -e LIVE_SESSION="$SESSION" -e CF_PARENT="$PARENT" -e CF_PUBLISH="$PUBLISH" -e CF_QUERY="${CF_QUERY:-БФТ}" -e CI=1 \
  -v "$PORTAL_DIR/customer-form/e2e/live:/work/e2e/live:ro" -v "$OUT:/work/test-results" -w /work \
  "$IMAGE" bash -c "npm init -y > /dev/null && npm i -s --no-audit --no-fund @playwright/test@$PW_VERSION > /dev/null \
    && npx playwright test -c e2e/live/playwright.config.ts confluence-publish; s=\$?; chown -R $(id -u):$(id -g) /work/test-results; exit \$s"
