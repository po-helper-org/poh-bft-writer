#!/usr/bin/env bash
# Выкладка портала заказчика на сервер (ADR-0014) — запускать локально из репозитория.
#   harness/deploy-server.sh            # закоммиченный HEAD → сервер, сборка, подъём
#   harness/deploy-server.sh --keys     # + ключи моделей из локального harness/.env (без вывода)
#
# Адрес сервера и портала — в локальном harness/deploy/server.env (в git не попадает;
# образец — harness/deploy/server.env.example). Без него скрипт не запускается.
#
# Что делает:
#  1. git archive HEAD → ~/$DEPLOY_DIR на сервере $DEPLOY_HOST (rsync --delete; .env и
#     память организации на сервере не трогаются). Держите отдельно от клона,
#     который ведёт автодеплой main.
#  2. Значения из server.env (адрес портала, имена хоста, источник данных, подсеть
#     docker) — в harness/.env на сервере, идемпотентно и без вывода значений.
#  3. Память организации (Кортекс) — клон poh-cortex на сервере, только чтение.
#  4. Образ портала собирается на сервере (x86_64), стек поднимается start.sh
#     с docker-compose.server.yml: портал 127.0.0.1:3082, трекер 127.0.0.1:3084.
#  5. nginx (/bft/ за Authentik, /bft-sources/mcp — шлюз источников) — разовый шаг
#     владельца с sudo:
#       bash ~/$DEPLOY_DIR/harness/deploy/install-nginx-bft.sh
#  6. Шлюз источников (Jira/Confluence только чтение, ADR-0015) — на сервере
#     без sudo, после выкладки и при смене токена:
#       bash ~/$DEPLOY_DIR/harness/deploy/install-sources-gateway.sh
#     Разово владельцу с sudo: sudo loginctl enable-linger <пользователь>
#     (иначе служба systemd --user останавливается после выхода из сессии)
#     и отзыв прежних доступов портала к шлюзу агентов — см. ADR-0015.
#  7. Память агента bft-creator (Кортекс, ADR-0016) — на сервере без sudo, после выкладки:
#       bash ~/$DEPLOY_DIR/harness/deploy/install-bft-memory.sh
#     Источники памяти — BFT_MEMORY_* в server.env; без них Кортекс читает клон poh-cortex.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SERVER_ENV="$ROOT/harness/deploy/server.env"
if [ ! -f "$SERVER_ENV" ]; then
  echo "✗ Нет $SERVER_ENV — адрес сервера и портала не задан." >&2
  echo "  cp harness/deploy/server.env.example harness/deploy/server.env и заполните (в git не попадает)." >&2
  exit 1
fi
set -a
# shellcheck source=/dev/null
. "$SERVER_ENV"
set +a
for v in DEPLOY_HOST DEPLOY_DIR PORTAL_PUBLIC_URL PORTAL_TRUSTED_HOSTS; do
  [ -n "${!v:-}" ] || { echo "✗ В $SERVER_ENV не задан $v" >&2; exit 1; }
done
HOST=$DEPLOY_HOST
# Пути на сервере (DEPLOY_DIR, SOURCES_MCP_CONFIG) — относительно домашнего, без ~ и
# без «/» в начале: «. server.env» раскрыл бы ~ в локальный $HOME.
for v in DEPLOY_DIR SOURCES_MCP_CONFIG BFT_MEMORY_DIR BFT_MEMORY_GLOSSARY BFT_MEMORY_ITMAP BFT_MEMORY_BFT BFT_MEMORY_CURATED; do
  case "${!v:-}" in
    /*|~*) echo "✗ $v в $SERVER_ENV — путь относительно домашнего каталога сервера, без ~ и «/» в начале" >&2; exit 1 ;;
  esac
done
REMOTE=$DEPLOY_DIR
PUBLIC_URL=${PORTAL_PUBLIC_URL%/}
KEYS=0
for arg in "$@"; do
  case "$arg" in
    --keys) KEYS=1 ;;
    *) echo "Неизвестный аргумент: $arg" >&2; exit 2 ;;
  esac
done

cd "$ROOT"
REV=$(git rev-parse --short HEAD)
# На сервер уходит только git archive HEAD: незакоммиченное и неотслеживаемое
# (новые файлы!) туда не попадёт — сервер соберёт старый код. Поэтому стоп, а не
# предупреждение; --untracked-files=all — чтобы видеть и новые файлы.
DIRTY=$(git status --porcelain --untracked-files=all -- customer-form data-sources bft-manager speech-ru skills \
  harness/harness-web harness/profile harness/docker-compose.yml harness/docker-compose.server.yml \
  harness/start.sh harness/deploy harness/deploy-server.sh harness/sources-gateway)
if [ -n "$DIRTY" ]; then
  echo "✗ Незакоммиченные или неотслеживаемые правки — на сервер ушёл бы $REV без них:" >&2
  printf '%s\n' "$DIRTY" | sed 's/^/    /' >&2
  echo "  Закоммитьте их и запустите снова." >&2
  exit 1
fi

echo "▸ $REV → $HOST:~/$REMOTE"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
git archive --format=tar HEAD | tar -x -C "$TMP"
echo "$REV" > "$TMP/harness/.deployed-rev"
ssh "$HOST" "mkdir -p ~/$REMOTE"
rsync -az --delete \
  --exclude 'harness/.env' --exclude 'harness/.last-url' --exclude '.cortex-vault/' --exclude '.e2e-live/' \
  "$TMP/" "$HOST:~/$REMOTE/"

# Строки KEY=VALUE со stdin → harness/.env на сервере (set_kv: старая строка ключа
# заменяется, файл 600). Значения не выводятся — только имена ключей.
push_env() {
  ssh "$HOST" "cd ~/$REMOTE/harness && touch .env && chmod 600 .env && while IFS= read -r line; do k=\${line%%=*}; grep -v \"^\$k=\" .env > .env.tmp || true; printf '%s\n' \"\$line\" >> .env.tmp; mv .env.tmp .env; chmod 600 .env; echo \"✓ \$k\"; done"
}

if [ "$KEYS" = 1 ]; then
  # Ключи моделей — строками из локального .env прямо в серверный, без вывода значений.
  grep -E '^(ANTHROPIC_API_KEY|ZAI_CODING_API_KEY|REQUESTY_API_KEY|ZAI_API_KEY)=..' "$ROOT/harness/.env" | push_env
fi

# Настройки сервера из server.env — в серверный .env (их читают docker compose,
# start.sh и скрипты harness/deploy/ на сервере). Пустые не переносятся.
{
  printf 'PORTAL_PUBLIC_URL=%s\n' "$PUBLIC_URL"
  for v in PORTAL_TRUSTED_HOSTS DATA_SOURCES_URL_ATLASSIAN SOURCES_MCP_CONFIG SOURCES_MCP_SERVER PORTAL_SUBNET \
    BFT_MEMORY_DIR BFT_MEMORY_GLOSSARY BFT_MEMORY_ITMAP BFT_MEMORY_BFT BFT_MEMORY_CURATED BFT_E2E_REQUEST_FILE BFT_FORM_PUBLIC; do
    [ -n "${!v:-}" ] && printf '%s=%s\n' "$v" "${!v}"
  done
  true
} | push_env

# Прежний источник (большой шлюз агентов, ADR-0015) — его адрес, каталог и
# служебный токен из серверного .env убираются; значения не выводятся.
ssh "$HOST" "umask 077 && cd ~/$REMOTE/harness && touch .env && chmod 600 .env && for k in DATA_SOURCES_URL_PO_HQ DATA_SOURCES_TOKEN_PO_HQ AGENT_GATEWAY_DIR; do if grep -q \"^\$k=\" .env; then grep -v \"^\$k=\" .env > .env.tmp || true; mv .env.tmp .env; chmod 600 .env; echo \"✓ убран \$k\"; fi; done"

ssh "$HOST" "bash -s" <<EOF
set -euo pipefail
cd ~/$REMOTE
# Память организации: свой клон poh-cortex (только чтение в контейнере).
if [ -d .cortex-vault/.git ]; then git -C .cortex-vault pull -q --ff-only || echo "⚠ poh-cortex не обновился"
else git clone -q https://github.com/po-helper-org/poh-cortex .cortex-vault; fi
cd harness
touch .env && chmod 600 .env
# Память bft-creator (install-bft-memory.sh) сама пишет CORTEX_VAULT; иначе — клон poh-cortex.
grep -q '^CORTEX_VAULT=' .env || printf 'CORTEX_VAULT=%s\n' "\$HOME/$REMOTE/.cortex-vault" >> .env
echo "▸ Сборка образа портала…"
docker build --network host -q -f harness-web/Dockerfile -t poh-harness-web:local .. > /dev/null
export COMPOSE_FILE=docker-compose.yml:docker-compose.server.yml COMPOSE_PROJECT_NAME=poh-bft-portal
export TRACKER_SEED_URL=http://127.0.0.1:3084/api/v1 PORTAL_PUBLIC_URL='$PUBLIC_URL'
./start.sh --no-open
docker compose up -d --force-recreate customer-web > /dev/null
for i in \$(seq 1 60); do [ "\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3082/)" = 200 ] && break; sleep 2; done
echo "▸ портал 127.0.0.1:3082 → \$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3082/)"
EOF
echo "✓ Выложено: $REV"
echo "  Снаружи: $PUBLIC_URL/ (после install-nginx-bft.sh)"
echo "  Администратор: $PUBLIC_URL/api/customer-form.admin — пароль: ADMIN_PASSWORD в ~/$REMOTE/harness/.env на сервере"
