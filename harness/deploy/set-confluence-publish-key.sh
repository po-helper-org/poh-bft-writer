#!/usr/bin/env bash
# Разовый шаг владельца (без sudo), на сервере портала: ключ публикации БФТ в Confluence
# (ADR-0028) → CONFLUENCE_PUBLISH_TOKEN в harness/.env, портал пересоздаётся с ним.
#   bash ~/<DEPLOY_DIR>/harness/deploy/set-confluence-publish-key.sh   # спросит ключ, ввод не печатается
# Ключ — личный токен Confluence (Server/DC) или API-токен (Cloud, тогда в server.env
# CONFLUENCE_PUBLISH_USER — email). Нужны права на создание страниц в разделах, куда публикуют.
# Адрес (CONFLUENCE_PUBLISH_URL) переносит deploy-server.sh из server.env.
set -euo pipefail
cd "$(dirname "$0")/.."
read -r -s -p "Ключ публикации Confluence: " KEY; echo
[ -n "$KEY" ] || { echo "✗ пустой ключ"; exit 1; }
case "$KEY" in *[[:space:]]*) echo "✗ в ключе пробелы"; exit 1 ;; esac
touch .env && chmod 600 .env
grep -v '^CONFLUENCE_PUBLISH_TOKEN=' .env > .env.tmp || true
printf 'CONFLUENCE_PUBLISH_TOKEN=%s\n' "$KEY" >> .env.tmp
mv .env.tmp .env && chmod 600 .env
echo "✓ CONFLUENCE_PUBLISH_TOKEN записан в harness/.env"
grep -q '^CONFLUENCE_PUBLISH_URL=.' .env || echo "! CONFLUENCE_PUBLISH_URL ещё не задан — впишите в server.env и выложите (deploy-server.sh)"
export COMPOSE_FILE=docker-compose.yml:docker-compose.server.yml COMPOSE_PROJECT_NAME=poh-bft-portal
docker compose up -d --force-recreate customer-web > /dev/null
echo "✓ портал пересоздан — на странице полного БФТ «⇪ В Confluence» публикует"
