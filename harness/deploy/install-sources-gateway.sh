#!/usr/bin/env bash
# Шлюз источников портала — Jira и Confluence только на чтение (ADR-0015).
# Запускать НА сервере под пользователем сервера (не root, без sudo), из выложенного
# портала:
#   bash ~/<DEPLOY_DIR>/harness/deploy/install-sources-gateway.sh [--rotate-token] [--relaxed-sandbox]
#
# Что делает (идемпотентно):
#   1. окружения ~/.local/share/bft-sources-gateway/{venv,atlassian-venv} (uv, иначе
#      python3 -m venv) с закреплёнными версиями из harness/sources-gateway/requirements*.txt,
#      код шлюза — в ~/.local/share/bft-sources-gateway/app;
#   2. ~/.config/bft-sources-gateway/env (600) — адреса и ключи Jira/Confluence из
#      конфигурации MCP-клиента: файл SOURCES_MCP_CONFIG (путь от домашнего каталога),
#      сервер SOURCES_MCP_SERVER (mcp_servers.<имя>.{command,args,env}; ${VAR} — из .env
#      рядом с YAML). Значения не выводятся;
#   3. токен портала: шлюз хранит только sha256 (~/.config/bft-sources-gateway/token.sha256,
#      600), сам токен — в harness/.env портала как DATA_SOURCES_TOKEN_ATLASSIAN.
#      Повторный запуск оставляет действующий токен; --rotate-token выпускает новый
#      (старый сразу перестаёт приниматься);
#   4. systemd --user сервис bft-sources-gateway (127.0.0.1:3086/mcp), проверка: без
#      токена — 401, с токеном — ровно четыре инструмента чтения;
#   5. пересоздаёт customer-web портала, чтобы он подхватил токен.
#
# SOURCES_MCP_CONFIG и SOURCES_MCP_SERVER — из окружения, иначе из harness/.env портала
# (их переносит harness/deploy-server.sh из harness/deploy/server.env).
# Наружу шлюз отдаёт nginx: location = /bft-sources/mcp в bft-portal.nginx.conf
# (ставит install-nginx-bft.sh, нужен sudo — шаг владельца).
#
# Отзыв доступа портала: --rotate-token (новый токен получит только портал) или
#   systemctl --user disable --now bft-sources-gateway
#
# --relaxed-sandbox — если systemd не может запустить сервис в песочнице (ядро без
# непривилегированных user namespaces: статус 226/NAMESPACE или 218/CAPABILITIES).
# Слабее: процессу виден домашний каталог (только чтение остаётся у системы).
set -euo pipefail

ROTATE=0
RELAXED=0
for arg in "$@"; do
  case "$arg" in
    --rotate-token) ROTATE=1 ;;
    --relaxed-sandbox) RELAXED=1 ;;
    -h|--help) sed -n '2,35p' "$0"; exit 0 ;;
    *) echo "Неизвестный аргумент: $arg" >&2; exit 2 ;;
  esac
done

[ "$(id -u)" != 0 ] || { echo "Запускать под пользователем сервера, не под root" >&2; exit 1; }

PORTAL=${PORTAL_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}
SRC=$PORTAL/harness/sources-gateway
ENV_FILE=$PORTAL/harness/.env
KEY=DATA_SOURCES_TOKEN_ATLASSIAN
GW_HOME=$HOME/.local/share/bft-sources-gateway
GW_CONF=$HOME/.config/bft-sources-gateway
GW_STATE=$HOME/.local/state/bft-sources-gateway
HASH_FILE=$GW_CONF/token.sha256
UNIT=bft-sources-gateway.service
UNIT_DIR=$HOME/.config/systemd/user
GW_PORT=${BFT_GW_PORT:-3086}
GW_PATH=${BFT_GW_PATH:-/mcp}
URL=http://127.0.0.1:$GW_PORT$GW_PATH

[ -f "$SRC/bft_sources_gateway.py" ] || { echo "Нет $SRC — сначала harness/deploy-server.sh" >&2; exit 1; }

# Настройка из harness/.env портала — только эти два ключа (значения — пути, не секреты).
env_get() { [ -f "$ENV_FILE" ] && grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2- || true; }
SOURCES_MCP_CONFIG=${SOURCES_MCP_CONFIG:-$(env_get SOURCES_MCP_CONFIG)}
SOURCES_MCP_SERVER=${SOURCES_MCP_SERVER:-$(env_get SOURCES_MCP_SERVER)}
[ -n "$SOURCES_MCP_CONFIG" ] || { echo "Не задан SOURCES_MCP_CONFIG — конфигурация MCP-клиента с сервером Jira/Confluence (harness/deploy/server.env)" >&2; exit 1; }
[ -n "$SOURCES_MCP_SERVER" ] || { echo "Не задан SOURCES_MCP_SERVER — имя сервера в mcp_servers этой конфигурации (harness/deploy/server.env)" >&2; exit 1; }
case "$SOURCES_MCP_CONFIG" in /*) CONFIG=$SOURCES_MCP_CONFIG ;; *) CONFIG=$HOME/${SOURCES_MCP_CONFIG#\~/} ;; esac
[ -f "$CONFIG" ] || { echo "Нет файла конфигурации $CONFIG" >&2; exit 1; }

umask 077
mkdir -p "$GW_HOME/app" "$GW_CONF" "$GW_STATE" "$UNIT_DIR"
chmod 700 "$GW_CONF" "$GW_STATE"

# --- 1. окружения и код -------------------------------------------------------------
make_venv() {  # $1 — каталог, $2 — файл требований
  if command -v uv > /dev/null; then
    [ -x "$1/bin/python" ] || uv venv -q --python '>=3.10' "$1"
    uv pip install -q --python "$1/bin/python" -r "$2"
  else
    if [ ! -x "$1/bin/python" ]; then
      python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))' \
        || { echo "Нужен python3 ≥ 3.10 или uv" >&2; exit 1; }
      python3 -m venv "$1"
    fi
    "$1/bin/python" -m pip install -q --disable-pip-version-check -r "$2"
  fi
}
echo "▸ окружения шлюза (закреплённые версии)…"
make_venv "$GW_HOME/venv" "$SRC/requirements.txt"
make_venv "$GW_HOME/atlassian-venv" "$SRC/requirements-atlassian.txt"
[ -x "$GW_HOME/atlassian-venv/bin/mcp-atlassian" ] || { echo "mcp-atlassian не установился" >&2; exit 1; }
install -m 644 "$SRC/bft_sources_gateway.py" "$GW_HOME/app/bft_sources_gateway.py"
PY=$GW_HOME/venv/bin/python
echo "✓ окружения: $GW_HOME"

# --- 2. окружение шлюза из конфигурации MCP-клиента ---------------------------------
BFT_GW_PORT=$GW_PORT BFT_GW_PATH=$GW_PATH \
  "$PY" "$SRC/build_env.py" "$CONFIG" "$SOURCES_MCP_SERVER" "$GW_CONF/env"

# --- 3. токен портала -------------------------------------------------------------
sha256_stdin() { "$PY" -c 'import sys,hashlib; print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())'; }

# Токен — только в переменных, не в выводе и не в аргументах команд (set -x не включать).
CURRENT=""
[ -f "$ENV_FILE" ] && CURRENT=$(grep -m1 "^$KEY=" "$ENV_FILE" | cut -d= -f2- || true)
TOKEN=""
if [ "$ROTATE" = 0 ] && [ -n "$CURRENT" ] && [ -f "$HASH_FILE" ] \
   && [ "$(printf '%s' "$CURRENT" | sha256_stdin)" = "$(tr -d ' \n' < "$HASH_FILE")" ]; then
  TOKEN=$CURRENT
  TOKEN_CHANGED=0
  echo "✓ токен портала прежний (sha256 совпадает; --rotate-token — выпустить новый)"
else
  TOKEN=$("$PY" -c 'import secrets; print(secrets.token_urlsafe(32))' 2>/dev/null || openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')
  TOKEN=${TOKEN//[$'\r\n']/}
  [ ${#TOKEN} -ge 32 ] || { echo "Не удалось выпустить токен" >&2; exit 1; }
  TMPH=$(mktemp "$GW_CONF/.token.XXXXXX")
  printf '%s' "$TOKEN" | sha256_stdin > "$TMPH"
  chmod 600 "$TMPH"
  mv "$TMPH" "$HASH_FILE"

  # set_kv: строка ключа заменяется, файл 600, значение не выводится.
  touch "$ENV_FILE"
  TMP=$(mktemp "$PORTAL/harness/.env.XXXXXX")
  trap 'rm -f "$TMP"' EXIT
  grep -v "^$KEY=" "$ENV_FILE" > "$TMP" || true
  printf '%s=%s\n' "$KEY" "$TOKEN" >> "$TMP"
  chmod 600 "$TMP"
  mv "$TMP" "$ENV_FILE"
  trap - EXIT
  TOKEN_CHANGED=1
  echo "✓ новый токен: sha256 → $HASH_FILE, токен → $KEY в $ENV_FILE (значение не выводится)"
fi
unset CURRENT

# --- 4. сервис systemd --user -----------------------------------------------------
# Интерпретаторы окружений могут быть ссылками на Python из домашнего каталога
# (так делает uv) — их каталоги нужно открыть сервису на чтение.
RO_PATHS=""
for venv in "$GW_HOME/venv" "$GW_HOME/atlassian-venv"; do
  real=$(readlink -f "$venv/bin/python")
  base=$(dirname "$(dirname "$real")")
  case "$base" in
    "$GW_HOME"|"$GW_HOME"/*) ;;
    "$HOME"/*) case " $RO_PATHS " in *" $base "*) ;; *) RO_PATHS="$RO_PATHS $base" ;; esac ;;
  esac
done
UNIT_TMP=$(mktemp)
if [ "$RELAXED" = 1 ]; then
  sed '/# sandbox:begin/,/# sandbox:end/d' "$SRC/bft-sources-gateway.service" > "$UNIT_TMP"
  echo "⚠ --relaxed-sandbox: сервис без ProtectSystem/ProtectHome/PrivateTmp"
else
  sed "s|@PYTHON_RO_PATHS@|${RO_PATHS# }|" "$SRC/bft-sources-gateway.service" > "$UNIT_TMP"
fi
install -m 644 "$UNIT_TMP" "$UNIT_DIR/$UNIT"
rm -f "$UNIT_TMP"

export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
systemctl --user daemon-reload
systemctl --user enable -q "$UNIT"
systemctl --user restart "$UNIT"
LINGER=$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true)
if [ "$LINGER" != yes ]; then
  echo "⚠ у пользователя не включён linger — сервис остановится после выхода из сессии."
  echo "  Шаг владельца (нужен sudo): sudo loginctl enable-linger $(id -un)"
fi

echo "▸ жду шлюз на 127.0.0.1:$GW_PORT…"
CODE=000
for _ in $(seq 1 30); do
  CODE=$(curl -s -m 5 -o /dev/null -w '%{http_code}' -X POST \
    -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "$URL" || true)
  [ "$CODE" = 401 ] && break
  sleep 1
done
if [ "$CODE" != 401 ]; then
  echo "✗ шлюз не отвечает 401 без токена (получено $CODE)" >&2
  systemctl --user --no-pager status "$UNIT" >&2 || true
  journalctl --user -u "$UNIT" -n 30 --no-pager >&2 || true
  echo "  если статус 226/NAMESPACE или 218/CAPABILITIES — повторите с --relaxed-sandbox" >&2
  exit 1
fi
echo "✓ без токена — 401"

# С токеном: ровно четыре инструмента. Токен передаётся через окружение процесса
# (видно только этому пользователю), не через аргументы.
BFT_GW_CHECK_TOKEN=$TOKEN BFT_GW_CHECK_URL=$URL "$PY" - <<'PYEOF'
import asyncio, os, sys
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport

want = {"jira_search", "jira_get_issue", "confluence_search", "confluence_get_page"}

async def main():
    t = StreamableHttpTransport(os.environ["BFT_GW_CHECK_URL"],
                                headers={"Authorization": "Bearer " + os.environ["BFT_GW_CHECK_TOKEN"]})
    async with Client(t) as c:
        names = {x.name for x in await c.list_tools()}
        res = await c.list_resources()
        prompts = await c.list_prompts()
    if names != want or res or prompts:
        print("✗ шлюз отдаёт не то: инструменты " + ", ".join(sorted(names))
              + f"; ресурсов {len(res)}, промптов {len(prompts)}", file=sys.stderr)
        sys.exit(1)
    print("✓ с токеном — ровно: " + ", ".join(sorted(names)))

asyncio.run(main())
PYEOF
unset TOKEN

# --- 5. портал подхватывает токен ---------------------------------------------------
cd "$PORTAL/harness"
COMPOSE_FILE=docker-compose.yml:docker-compose.server.yml COMPOSE_PROJECT_NAME=poh-bft-portal \
  docker compose up -d --force-recreate customer-web
echo "✓ customer-web пересоздан: «Настройки → Источники данных» — Jira и Confluence (только чтение)"
if [ "$TOKEN_CHANGED" = 1 ]; then echo "  токен новый — прежний (если был) больше не принимается"; fi
echo "  снаружи шлюз доступен после install-nginx-bft.sh (location = /bft-sources/mcp)"
if [ "$LINGER" != yes ]; then
  echo "⚠ НЕ ГОТОВО до шага владельца: sudo loginctl enable-linger $(id -un)" >&2
  echo "  без него шлюз остановится после выхода из ssh-сессии, портал получит отказ соединения." >&2
fi
