#!/usr/bin/env bash
# Шаг владельца (без sudo), на сервере портала: ключ публикации БФТ в Confluence (ADR-0028, ADR-0030)
# → CONFLUENCE_PUBLISH_TOKEN в harness/.env; с ним пересоздаётся только исполнитель публикации
# confluence-publisher (портал с агентами ключа не получает).
#
#   bash ~/<DEPLOY_DIR>/harness/deploy/set-confluence-publish-key.sh
#       спросит ключ (ввод не печатается)
#   bash ~/<DEPLOY_DIR>/harness/deploy/set-confluence-publish-key.sh --from-env <файл .env> <ПЕРЕМЕННАЯ>
#       возьмёт значение из другого окружения на этом сервере (например, окружения ИИ-агентов,
#       где уже есть доступ к Confluence) — файл и имя переменной называет владелец
#
# Значение не печатается и не попадает в аргументы команд. После записи — проверка входа:
# GET /rest/api/user/current с этим ключом (с хоста: Confluence бывает доступен только через VPN
# хоста). Анонимный ответ — ключ не принят. Право записи проверится при первой отправке.
#
# Ключ можно задать и в «Настройки → Ключи и доступы» портала — там он главнее harness/.env.
# Адрес (CONFLUENCE_PUBLISH_URL) переносит deploy-server.sh из server.env.
set -euo pipefail
cd "$(dirname "$0")/.."

KEY=""
if [ "${1:-}" = "--from-env" ]; then
  SRC=${2:?нужен путь к файлу .env}
  VAR=${3:?нужно имя переменной в нём}
  [ -f "$SRC" ] || { echo "✗ нет файла $SRC"; exit 1; }
  [[ "$VAR" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "✗ имя переменной — буквы, цифры, _"; exit 1; }
  n=$(grep -cE "^(export[[:space:]]+)?$VAR=" "$SRC" || true)
  [ "$n" = 1 ] || { echo "✗ в $SRC переменная $VAR встречается $n раз — нужна ровно одна"; exit 1; }
  KEY=$(grep -E "^(export[[:space:]]+)?$VAR=" "$SRC" | head -1 | sed -E "s/^(export[[:space:]]+)?$VAR=//; s/^['\"]//; s/['\"][[:space:]]*$//; s/[[:space:]]+$//")
  case "$KEY" in \$*) echo "✗ значение $VAR — ссылка на другую переменную (\$…), задайте ключ явно"; exit 1 ;; esac
else
  read -r -s -p "Ключ публикации Confluence: " KEY; echo
fi
[ -n "$KEY" ] || { echo "✗ пустой ключ"; exit 1; }
case "$KEY" in *[[:space:]]*) echo "✗ в ключе пробелы"; exit 1 ;; esac

umask 077
touch .env && chmod 600 .env
grep -v '^CONFLUENCE_PUBLISH_TOKEN=' .env > .env.tmp || true
printf 'CONFLUENCE_PUBLISH_TOKEN=%s\n' "$KEY" >> .env.tmp
mv .env.tmp .env && chmod 600 .env
echo "✓ CONFLUENCE_PUBLISH_TOKEN записан в harness/.env (права 600)"

URL=$(grep -m1 '^CONFLUENCE_PUBLISH_URL=' .env | cut -d= -f2- || true)
USER_=$(grep -m1 '^CONFLUENCE_PUBLISH_USER=' .env | cut -d= -f2- || true)
if [ -z "$URL" ]; then
  echo "! CONFLUENCE_PUBLISH_URL ещё не задан — впишите в server.env и выложите (deploy-server.sh)"
else
  # Ключ — в конфиге curl со stdin, не в аргументах (его не видно в ps).
  BODY=$(mktemp); trap 'rm -f "$BODY"' EXIT
  if [ -n "$USER_" ]; then AUTH="user = \"$USER_:$KEY\""; else AUTH="header = \"Authorization: Bearer $KEY\""; fi
  CODE=$(printf '%s\n' "$AUTH" | curl -s -m 20 -o "$BODY" -w '%{http_code}' -K - "$URL/rest/api/user/current" || echo 000)
  if [ "$CODE" = 200 ] && ! grep -q '"type":"anonymous"' "$BODY"; then echo "✓ Confluence принял ключ (200, вход не анонимный)"
  elif [ "$CODE" = 200 ]; then echo "✗ Confluence ответил анонимно — ключ не принят (неверный или истёк)"
  else echo "✗ Confluence ответил $CODE — проверьте ключ и адрес"; fi
fi
unset KEY AUTH

export COMPOSE_FILE=docker-compose.yml:docker-compose.server.yml COMPOSE_PROJECT_NAME=poh-bft-portal
docker compose up -d --force-recreate confluence-publisher > /dev/null
echo "✓ confluence-publisher пересоздан — на странице полного БФТ «⇪ В Confluence» публикует"
