#!/usr/bin/env bash
# Выкладка портала заказчика на сервер (ADR-0014) — запускать локально из репозитория.
#   harness/deploy-server.sh            # закоммиченный HEAD → сервер, сборка, подъём
#   harness/deploy-server.sh --keys     # + ключи моделей из локального harness/.env (без вывода)
#
# Что делает:
#  1. git archive HEAD → ~/Projects/poh-bft-portal на сервере (rsync --delete; .env и
#     память организации на сервере не трогаются). Отдельно от ~/Projects/poh-bft-writer:
#     тот клон ведёт автодеплой main.
#  2. Память организации (Кортекс) — клон poh-cortex на сервере, только чтение.
#  3. Образ портала собирается на сервере (x86_64), стек поднимается start.sh
#     с docker-compose.server.yml: портал 127.0.0.1:3082, трекер 127.0.0.1:3084.
#  4. nginx (/bft/ за Authentik) — разовый шаг владельца с sudo:
#       bash ~/Projects/poh-bft-portal/harness/deploy/install-nginx-bft.sh
set -euo pipefail
HOST=${DEPLOY_HOST:-harness-mts}
REMOTE=${DEPLOY_DIR:-Projects/poh-bft-portal}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
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
  harness/start.sh harness/deploy harness/deploy-server.sh)
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
  --exclude 'harness/.env' --exclude 'harness/.last-url' --exclude '.cortex-vault/' \
  "$TMP/" "$HOST:~/$REMOTE/"

if [ "$KEYS" = 1 ]; then
  # Ключи моделей — строками из локального .env прямо в серверный, без вывода значений.
  grep -E '^(ANTHROPIC_API_KEY|ZAI_CODING_API_KEY|REQUESTY_API_KEY|ZAI_API_KEY)=..' "$ROOT/harness/.env" \
    | ssh "$HOST" "cd ~/$REMOTE/harness && touch .env && chmod 600 .env && while IFS= read -r line; do k=\${line%%=*}; grep -v \"^\$k=\" .env > .env.tmp || true; printf '%s\n' \"\$line\" >> .env.tmp; mv .env.tmp .env; chmod 600 .env; echo \"✓ \$k\"; done"
fi

ssh "$HOST" "bash -s" <<EOF
set -euo pipefail
cd ~/$REMOTE
# Память организации: свой клон poh-cortex (только чтение в контейнере).
if [ -d .cortex-vault/.git ]; then git -C .cortex-vault pull -q --ff-only || echo "⚠ poh-cortex не обновился"
else git clone -q https://github.com/po-helper-org/poh-cortex .cortex-vault; fi
cd harness
touch .env && chmod 600 .env
grep -q '^CORTEX_VAULT=' .env || printf 'CORTEX_VAULT=%s\n' "\$HOME/$REMOTE/.cortex-vault" >> .env
echo "▸ Сборка образа портала…"
docker build --network host -q -f harness-web/Dockerfile -t poh-harness-web:local .. > /dev/null
export COMPOSE_FILE=docker-compose.yml:docker-compose.server.yml COMPOSE_PROJECT_NAME=poh-bft-portal
export TRACKER_SEED_URL=http://127.0.0.1:3084/api/v1 PORTAL_PUBLIC_URL=https://browser.harness.aleksishmanov.ru/bft
./start.sh --no-open
docker compose up -d --force-recreate customer-web > /dev/null
for i in \$(seq 1 60); do [ "\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3082/)" = 200 ] && break; sleep 2; done
echo "▸ портал 127.0.0.1:3082 → \$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3082/)"
EOF
echo "✓ Выложено: $REV"
echo "  Снаружи: https://browser.harness.aleksishmanov.ru/bft/ (после install-nginx-bft.sh)"
echo "  Администратор: https://browser.harness.aleksishmanov.ru/bft/api/customer-form.admin — пароль: ADMIN_PASSWORD в ~/$REMOTE/harness/.env на сервере"
