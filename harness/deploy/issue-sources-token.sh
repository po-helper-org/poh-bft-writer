#!/usr/bin/env bash
# Служебный токен источников данных портала (ADR-0013, ADR-0014) — запускать НА
# сервере под aleks:
#   bash ~/Projects/poh-bft-portal/harness/deploy/issue-sources-token.sh
#
# Мост Hermes («Штаб», ~/Projects/poh-hermes-bridge) выпускает токен bft-portal с
# белым списком jira_search, jira_get_issue, confluence_search, confluence_get_page
# (в мосте хранится только sha256). Скрипт кладёт токен в harness/.env портала как
# DATA_SOURCES_TOKEN_PO_HQ (через временный файл 600, значение не печатается) и
# пересоздаёт customer-web. Повторный запуск выпускает новый токен; если мост
# не выпустил его, .env не меняется. Отзыв (в папке моста):
#   .venv/bin/python -m bridge.service_token revoke bft-portal
set -euo pipefail

BRIDGE=${BRIDGE_DIR:-$HOME/Projects/poh-hermes-bridge}
PORTAL=${PORTAL_DIR:-$HOME/Projects/poh-bft-portal}
NAME=bft-portal
TOOLS=jira_search,jira_get_issue,confluence_search,confluence_get_page
KEY=DATA_SOURCES_TOKEN_PO_HQ
ENV_FILE=$PORTAL/harness/.env

[ "$(id -un)" = aleks ] || { echo "Запускать под aleks на сервере" >&2; exit 1; }
[ -x "$BRIDGE/.venv/bin/python" ] || { echo "Нет $BRIDGE/.venv/bin/python — мост не установлен" >&2; exit 1; }
[ -d "$PORTAL/harness" ] || { echo "Нет $PORTAL/harness — сначала harness/deploy-server.sh" >&2; exit 1; }

umask 077
TMP=$(mktemp "$PORTAL/harness/.env.XXXXXX")
trap 'rm -f "$TMP"' EXIT

# Токен — только в переменную, не в вывод и не в журнал (set -x не включать).
TOKEN=$(cd "$BRIDGE" && .venv/bin/python -m bridge.service_token issue "$NAME" --tools "$TOOLS" --out -)
TOKEN=${TOKEN//[$'\r\n']/}
[ -n "$TOKEN" ] || { echo "Мост не выдал токен" >&2; exit 1; }

touch "$ENV_FILE"
grep -v "^$KEY=" "$ENV_FILE" > "$TMP" || true
printf '%s=%s\n' "$KEY" "$TOKEN" >> "$TMP"
unset TOKEN
chmod 600 "$TMP"
mv "$TMP" "$ENV_FILE"
trap - EXIT
echo "✓ $KEY записан в $ENV_FILE (значение не выводится)"

cd "$PORTAL/harness"
COMPOSE_FILE=docker-compose.yml:docker-compose.server.yml COMPOSE_PROJECT_NAME=poh-bft-portal \
  docker compose up -d --force-recreate customer-web
echo "✓ customer-web пересоздан: «Настройки → Источники данных» — «подключён служебным токеном Hermes»"
echo "  прежнее OAuth-подключение (если было) портал удаляет и отзывает сам — см. «прежнее OAuth-подключение удалено» в docker compose logs customer-web"
