#!/usr/bin/env bash
# Обновление автономной системы (ADR-0002): git pull && ./harness/update.sh.
# Профиль и плагин пересобираются в образе; данные (volumes dshdata, pgdata,
# workspace) не трогаются; состояние коробки переживает рестарт (ADR-0001).
set -euo pipefail
cd "$(dirname "$0")"
echo "▸ Пересборка образов…"
docker compose build
echo "▸ Перезапуск сервисов…"
docker compose up -d
echo "✓ Готово. Новая ссылка с токеном — ./start.sh (или docker compose logs harness-web)."
