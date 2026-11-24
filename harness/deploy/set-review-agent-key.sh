#!/usr/bin/env bash
# Разовый шаг владельца (без sudo), на сервере портала: ключ агента полного ревью БФТ
# (ADR-0024) → BFT_REVIEW_AGENT_KEY в harness/.env, портал пересоздаётся с ним.
#   bash ~/<DEPLOY_DIR>/harness/deploy/set-review-agent-key.sh      # спросит ключ, ввод не печатается
# Адрес агента (BFT_REVIEW_AGENT_URL) переносит deploy-server.sh из server.env.
set -euo pipefail
cd "$(dirname "$0")/.."
read -r -s -p "Ключ агента полного ревью: " KEY; echo
[ -n "$KEY" ] || { echo "✗ пустой ключ"; exit 1; }
case "$KEY" in *[[:space:]]*) echo "✗ в ключе пробелы"; exit 1 ;; esac
touch .env && chmod 600 .env
grep -v '^BFT_REVIEW_AGENT_KEY=' .env > .env.tmp || true
printf 'BFT_REVIEW_AGENT_KEY=%s\n' "$KEY" >> .env.tmp
mv .env.tmp .env && chmod 600 .env
echo "✓ BFT_REVIEW_AGENT_KEY записан в harness/.env"
grep -q '^BFT_REVIEW_AGENT_URL=.' .env || echo "! BFT_REVIEW_AGENT_URL ещё не задан — впишите в server.env и выложите (deploy-server.sh)"
export COMPOSE_FILE=docker-compose.yml:docker-compose.server.yml COMPOSE_PROJECT_NAME=poh-bft-portal
docker compose up -d --force-recreate customer-web > /dev/null
echo "✓ портал пересоздан — «Настройки → Портал → ИИ-агент: полное ревью» покажет агента"
