#!/usr/bin/env bash
# Коробка БФТ без Docker и без sudo — под systemd --user (сервер, где у пользователя нет docker).
# Temporal — dev-сервер на SQLite (бинарь `temporal`), данные коробки — SQLite, процессы — юниты пользователя.
#   bash deploy/native/install.sh [--llm-base URL] [--llm-key-file ПУТЬ] [--llm-model ИМЯ] [--no-json-mode] [--temporal-bin ПУТЬ]
# Идемпотентно: настройки и токены создаются один раз (секреты не печатаются), юниты перезаписываются, сервисы перезапускаются.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="${BOX_BASE:-$HOME/.local/share/poh-bft-box}"
CONF="${BOX_CONF:-$HOME/.config/poh-bft-box}"
UNITS="$HOME/.config/systemd/user"
LLM_BASE="" ; LLM_KEY_FILE="" ; LLM_MODEL="" ; JSON_MODE=1 ; TEMPORAL_BIN="${TEMPORAL_BIN:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --llm-base) LLM_BASE="$2"; shift 2;; --llm-key-file) LLM_KEY_FILE="$2"; shift 2;; --llm-model) LLM_MODEL="$2"; shift 2;;
    --no-json-mode) JSON_MODE=0; shift;; --temporal-bin) TEMPORAL_BIN="$2"; shift 2;; *) echo "неизвестный ключ $1"; exit 2;;
  esac
done
[ -n "$TEMPORAL_BIN" ] || TEMPORAL_BIN="$(command -v temporal || true)"
[ -x "$TEMPORAL_BIN" ] || { echo "нет бинаря temporal: --temporal-bin ПУТЬ (https://temporal.io/setup/install-temporal-cli)"; exit 1; }
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

echo "== 1/5 Python-окружение"
if [ ! -x "$DIR/.venv/bin/python" ]; then
  if command -v uv >/dev/null; then uv venv -q "$DIR/.venv" --python 3.12 2>/dev/null || uv venv -q "$DIR/.venv"; else python3 -m venv "$DIR/.venv"; fi
fi
if command -v uv >/dev/null; then uv pip install -q --python "$DIR/.venv/bin/python" -r "$DIR/requirements.txt"; else "$DIR/.venv/bin/pip" install -q -r "$DIR/requirements.txt"; fi
"$DIR/.venv/bin/python" -c "import temporalio, fastmcp, bftbox.store; print('ok:', temporalio.__name__, fastmcp.__name__)"

echo "== 2/5 Настройки ($CONF)"
install -d -m 700 "$CONF" "$BASE"
ENV="$CONF/box.env"
if [ ! -s "$ENV" ]; then
  rnd() { head -c 24 /dev/urandom | base64 | tr -d '/+=\n'; }
  H="$(rnd)"; U="$(rnd)"
  install -m 600 /dev/null "$ENV"
  cat > "$ENV" <<EOT
DATABASE_URL=sqlite:///$BASE/box.db
TEMPORAL_ADDRESS=127.0.0.1:7233
TEMPORAL_UI_URL=http://127.0.0.1:8233
BOX_TOKENS=hermes:$H,ui:$U
BOX_ADMINS=ui
HOST=127.0.0.1
PORT=8700
METRICS_HOST=127.0.0.1
METRICS_PORT=9101
EOT
  install -m 600 /dev/null "$CONF/ui-token"; printf '%s' "$U" > "$CONF/ui-token"
  echo "токены созданы (в $ENV и $CONF/ui-token, 600)"
fi
setenv() { grep -q "^$1=" "$ENV" && sed -i "s|^$1=.*|$1=$2|" "$ENV" || echo "$1=$2" >> "$ENV"; }
[ -z "$LLM_BASE" ] || setenv LLM_BASE_URL "$LLM_BASE"
[ -z "$LLM_KEY_FILE" ] || setenv LLM_API_KEY_FILE "$LLM_KEY_FILE"
[ -z "$LLM_MODEL" ] || setenv LLM_MODEL "$LLM_MODEL"
setenv LLM_JSON_MODE "$JSON_MODE"
chmod 600 "$ENV"

echo "== 3/5 Юниты"
install -d "$UNITS"
cat > "$UNITS/poh-bft-temporal.service" <<EOT
[Unit]
Description=poh-bft-box: Temporal (dev-сервер на SQLite, 127.0.0.1:7233, UI :8233)
[Service]
ExecStart=$TEMPORAL_BIN server start-dev --ip 127.0.0.1 --port 7233 --ui-ip 127.0.0.1 --ui-port 8233 --db-filename $BASE/temporal.db --log-level warn
Restart=always
RestartSec=5
MemoryMax=512M
[Install]
WantedBy=default.target
EOT
for role in worker mcp; do
  case $role in worker) mod=bftbox.worker; mem=256M; desc="воркер (модель, итерации)";; mcp) mod=bftbox.mcp_server; mem=256M; desc="MCP и JSON-API (127.0.0.1:8700)";; esac
  cat > "$UNITS/poh-bft-$role.service" <<EOT
[Unit]
Description=poh-bft-box: $desc
After=poh-bft-temporal.service
Requires=poh-bft-temporal.service
[Service]
WorkingDirectory=$DIR
EnvironmentFile=$ENV
ExecStart=$DIR/.venv/bin/python -m $mod
Restart=always
RestartSec=5
MemoryMax=$mem
[Install]
WantedBy=default.target
EOT
done
systemctl --user daemon-reload

echo "== 4/5 Запуск"
systemctl --user enable -q poh-bft-temporal poh-bft-worker poh-bft-mcp
systemctl --user restart poh-bft-temporal
for _ in $(seq 1 30); do (echo > /dev/tcp/127.0.0.1/7233) 2>/dev/null && break; sleep 1; done
systemctl --user restart poh-bft-worker poh-bft-mcp

echo "== 5/5 Проверка"
for _ in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:8700/health && break; sleep 1; done
curl -sf http://127.0.0.1:8700/health >/dev/null || { journalctl --user -u poh-bft-mcp -n 20 --no-pager; exit 1; }
curl -sf http://127.0.0.1:8700/metrics | grep -c '^bft_box_' | sed 's/^/метрик bft_box_*: /'
systemctl --user is-active poh-bft-temporal poh-bft-worker poh-bft-mcp | tr '\n' ' '; echo
grep -q '^LLM_BASE_URL=' "$ENV" || echo "! модель не настроена: --llm-base / --llm-key-file (без неё итерации получат статус error)"
echo "Дальше: в config.json харнесса — bft_box_url=http://127.0.0.1:8700, bft_box_token_file=$CONF/ui-token"
