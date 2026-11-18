#!/usr/bin/env bash
# Служебный токен источников данных портала (ADR-0013, ADR-0014) — запускать НА
# сервере под пользователем сервера (не root), из выложенного портала:
#   bash ~/<DEPLOY_DIR>/harness/deploy/issue-sources-token.sh
#
# Шлюз агентов (MCP-шлюз, каталог — AGENT_GATEWAY_DIR) выпускает токен bft-portal с
# белым списком jira_search, jira_get_issue, confluence_search, confluence_get_page
# (в шлюзе хранится только sha256). Скрипт кладёт токен в harness/.env портала как
# DATA_SOURCES_TOKEN_PO_HQ (через временный файл 600, значение не печатается) и
# пересоздаёт customer-web. Повторный запуск выпускает новый токен; если шлюз
# не выпустил его, .env не меняется. Отзыв (в каталоге шлюза):
#   .venv/bin/python -m bridge.service_token revoke bft-portal
#
# Каталог шлюза: переменная AGENT_GATEWAY_DIR, иначе — строка AGENT_GATEWAY_DIR из
# harness/.env портала (её переносит deploy-server.sh из harness/deploy/server.env).
set -euo pipefail

PORTAL=${PORTAL_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}
NAME=bft-portal
TOOLS=jira_search,jira_get_issue,confluence_search,confluence_get_page
KEY=DATA_SOURCES_TOKEN_PO_HQ
ENV_FILE=$PORTAL/harness/.env

if [ -z "${AGENT_GATEWAY_DIR:-}" ] && [ -f "$ENV_FILE" ]; then
  AGENT_GATEWAY_DIR=$(grep -m1 '^AGENT_GATEWAY_DIR=' "$ENV_FILE" | cut -d= -f2- || true)
fi
GATEWAY=${AGENT_GATEWAY_DIR:-}
GATEWAY=${GATEWAY/#\~/$HOME}
# Относительный путь — от домашнего каталога пользователя сервера.
case "$GATEWAY" in ''|/*) ;; *) GATEWAY=$HOME/$GATEWAY ;; esac

[ "$(id -u)" != 0 ] || { echo "Запускать под пользователем сервера, не под root" >&2; exit 1; }
[ -n "$GATEWAY" ] || { echo "Не задан AGENT_GATEWAY_DIR — каталог шлюза агентов (harness/deploy/server.env)" >&2; exit 1; }
[ -x "$GATEWAY/.venv/bin/python" ] || { echo "Нет $GATEWAY/.venv/bin/python — шлюз агентов не установлен" >&2; exit 1; }
[ -d "$PORTAL/harness" ] || { echo "Нет $PORTAL/harness — сначала harness/deploy-server.sh" >&2; exit 1; }

umask 077
TMP=$(mktemp "$PORTAL/harness/.env.XXXXXX")
trap 'rm -f "$TMP"' EXIT

# Токен — только в переменную, не в вывод и не в журнал (set -x не включать).
TOKEN=$(cd "$GATEWAY" && .venv/bin/python -m bridge.service_token issue "$NAME" --tools "$TOOLS" --out -)
TOKEN=${TOKEN//[$'\r\n']/}
[ -n "$TOKEN" ] || { echo "Шлюз агентов не выдал токен" >&2; exit 1; }

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
echo "✓ customer-web пересоздан: «Настройки → Источники данных» — подключён служебным токеном шлюза"
echo "  прежнее OAuth-подключение (если было) портал удаляет и отзывает сам — см. «прежнее OAuth-подключение удалено» в docker compose logs customer-web"
