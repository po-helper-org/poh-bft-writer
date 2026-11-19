#!/usr/bin/env bash
# Живой E2E /bft (ADR-0016): настоящая модель, память bft-creator, Jira/Confluence.
# Запускать НА сервере из выложенного портала, без sudo:
#   bash ~/<DEPLOY_DIR>/harness/e2e-bft-live.sh
#   LIVE_REQUEST='…' bash …/e2e-bft-live.sh     # своё обращение
# Обращение по умолчанию — файл BFT_E2E_REQUEST_FILE (путь от домашнего каталога, из
# harness/.env; переносит deploy-server.sh): текст в домене, который знает память,
# хранится только на сервере — предметную область организации в репозиторий не пишем.
#
# 1. Проверяет, что Кортекс читает память bft-creator (не демо) — иначе стоп.
# 2. Playwright в контейнере (--network host) проходит путь заказчика на портале
#    127.0.0.1:3082: обращение → вопросы → сценарий → fast → «Да, согласен» → полный БФТ
#    (customer-form/e2e/live/bft-full.spec.ts). Заявка настоящая, с пометкой [E2E].
# 3. Забирает файлы заявки из тома портала и проверяет опору на память и источники
#    (harness/e2e-bft-live-check.py). Отчёт — .e2e-live/<время>/live-report.md.
# Длится 10–25 минут и тратит квоту модели портала.
set -euo pipefail
HARNESS=$(cd "$(dirname "$0")" && pwd)
PORTAL_DIR=$(cd "$HARNESS/.." && pwd)
export PATH="$HOME/.orbstack/bin:$PATH"
export COMPOSE_FILE=$HARNESS/docker-compose.yml:$HARNESS/docker-compose.server.yml COMPOSE_PROJECT_NAME=poh-bft-portal
PORTAL_URL=${PORTAL_URL:-http://127.0.0.1:3082}
if [ -z "${LIVE_REQUEST:-}" ]; then
  req=$(grep -m1 '^BFT_E2E_REQUEST_FILE=' "$HARNESS/.env" 2>/dev/null | cut -d= -f2- || true)
  [ -n "$req" ] && [ -f "$HOME/$req" ] && LIVE_REQUEST=$(cat "$HOME/$req")
fi
[ -n "${LIVE_REQUEST:-}" ] || echo "⚠ нет BFT_E2E_REQUEST_FILE — нейтральное обращение, опору на память оно не покажет"
PW_VERSION=${PW_VERSION:-1.64.1}
IMAGE=mcr.microsoft.com/playwright:v$PW_VERSION-noble
OUT=$PORTAL_DIR/.e2e-live/$(date +%Y%m%d-%H%M%S)
mkdir -p "$OUT/artifacts"

cd "$HARNESS"
web=$(docker compose ps -q customer-web)
cortex=$(docker compose ps -q cortex)
[ -n "$web" ] && [ -n "$cortex" ] || { echo "✗ портал не поднят (customer-web, cortex)" >&2; exit 1; }
docker exec "$cortex" python3 -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8095/health', timeout=5).read().decode())" > "$OUT/cortex-health.json"
echo "▸ Кортекс: $(cat "$OUT/cortex-health.json")"
grep -q '"demo": false' "$OUT/cortex-health.json" || { echo "✗ Кортекс без памяти bft-creator — сначала harness/deploy/install-bft-memory.sh" >&2; exit 1; }

docker image inspect "$IMAGE" > /dev/null 2>&1 || { echo "▸ образ Playwright $PW_VERSION"; docker pull -q "$IMAGE" > /dev/null; }
echo "▸ живой прогон: $PORTAL_URL → $OUT"
status=0
docker run --rm --network host --ipc host \
  -e PORTAL_URL="$PORTAL_URL" -e LIVE_REQUEST="${LIVE_REQUEST:-}" -e CI=1 \
  -v "$PORTAL_DIR/customer-form/e2e/live:/work/e2e/live:ro" -v "$OUT:/work/test-results" -w /work \
  "$IMAGE" bash -c "npm init -y > /dev/null && npm i -s --no-audit --no-fund @playwright/test@$PW_VERSION > /dev/null \
    && npx playwright test -c e2e/live/playwright.config.ts bft-full; s=\$?; chown -R $(id -u):$(id -g) /work/test-results; exit \$s" || status=$?

slug=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('slug',''))" "$OUT/live-run.json" 2>/dev/null || true)
if [ -n "$slug" ]; then
  for f in context_map.md sources.md deep.json primary.json intake.json "$slug.md" "$slug-fast.md"; do
    docker cp "$web:/data/bft-fast/$slug/$f" "$OUT/artifacts/$f" > /dev/null 2>&1 || true
  done
  python3 "$HARNESS/e2e-bft-live-check.py" "$OUT" || status=1
else
  echo "✗ тест не дошёл до полного БФТ — заявки для проверки нет (см. вывод Playwright и $OUT)" >&2
  status=1
fi
echo "▸ каталог прогона: $OUT"
exit "$status"
