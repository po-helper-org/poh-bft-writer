#!/usr/bin/env bash
# Живой E2E «Ответы формы → входящее событие в БФТ» (ADR-0027) — на сервере, без sudo:
#   bash ~/<DEPLOY_DIR>/harness/e2e-form-inbox.sh [<sessionId заявки с готовым полным БФТ>]
# Только ТЕСТОВАЯ заявка: без аргумента — сессия последнего живого прогона (.e2e-live/*/live-run.json).
# Playwright в контейнере (--network host) на 127.0.0.1:3082: ответы по форме, плашка
# «Ответы отправлены», «Форма заполнена» на странице БФТ без перезагрузки, входящие
# в сайдбаре, ответы по клику, статус пересборки из цикла (модель, 5–15 минут). Итог — .e2e-live/inbox-<время>/.
set -euo pipefail
HARNESS=$(cd "$(dirname "$0")" && pwd)
PORTAL_DIR=$(cd "$HARNESS/.." && pwd)
export PATH="$HOME/.orbstack/bin:$PATH"
PORTAL_URL=${PORTAL_URL:-http://127.0.0.1:3082}
SESSION=${1:-}
if [ -z "$SESSION" ]; then
  last=$(ls -1d "$PORTAL_DIR"/.e2e-live/2*/live-run.json 2>/dev/null | tail -1 || true)
  [ -n "$last" ] && SESSION=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['sessionId'])" "$last")
fi
[ -n "$SESSION" ] || { echo "✗ нужна сессия заявки с готовым полным БФТ (аргумент или прошлый живой прогон)" >&2; exit 1; }
PW_VERSION=${PW_VERSION:-1.64.1}
IMAGE=mcr.microsoft.com/playwright:v$PW_VERSION-noble
OUT=$PORTAL_DIR/.e2e-live/inbox-$(date +%Y%m%d-%H%M%S)
mkdir -p "$OUT"
docker image inspect "$IMAGE" > /dev/null 2>&1 || docker pull -q "$IMAGE" > /dev/null
echo "▸ входящие формы: $PORTAL_URL, сессия ${SESSION:0:8}… → $OUT"
docker run --rm --network host --ipc host \
  -e PORTAL_URL="$PORTAL_URL" -e LIVE_SESSION="$SESSION" -e CI=1 \
  -v "$PORTAL_DIR/customer-form/e2e/live:/work/e2e/live:ro" -v "$OUT:/work/test-results" -w /work \
  "$IMAGE" bash -c "npm init -y > /dev/null && npm i -s --no-audit --no-fund @playwright/test@$PW_VERSION > /dev/null \
    && npx playwright test -c e2e/live/playwright.config.ts form-inbox; s=\$?; chown -R $(id -u):$(id -g) /work/test-results; exit \$s"
