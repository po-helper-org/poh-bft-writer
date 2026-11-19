#!/usr/bin/env bash
# Память агента bft-creator — то, на что опирается /bft (ADR-0016).
# Запускать НА сервере под пользователем сервера (не root, без sudo), из выложенного портала:
#   bash ~/<DEPLOY_DIR>/harness/deploy/install-bft-memory.sh            # наполнить и подключить
#   bash ~/<DEPLOY_DIR>/harness/deploy/install-bft-memory.sh --refresh  # только обновить (таймер)
#
# Память — vault poh-cortex в BFT_MEMORY_DIR (путь от домашнего каталога). Коробка не
# зависит от агентов вокруг неё: в память идут только источники, которые владелец указал
# в harness/deploy/server.env (deploy-server.sh переносит их в harness/.env сервера):
#   BFT_MEMORY_GLOSSARY  словарь JSON {термин: {meaning, deleted?}}       → Нексус glossary
#   BFT_MEMORY_ITMAP     IT-карта, markdown                               → узел landscape
#   BFT_MEMORY_BFT       итоговые БФТ прошлых заявок, markdown, через запятую → bft-archive;
#                        «имя=путь» — имя узла и источника (bft:<имя>), иначе имя файла
#                        (без пробелов: start.sh подключает .env как скрипт bash)
#   BFT_MEMORY_CURATED   каталог готовых узлов (разбор прошлых БФТ)       → landscape,
#                        processes, domains, team, glossary
# Все пути — от домашнего каталога, без ~ и «/» в начале. Пустой — источник пропускается.
#
# Что делает (идемпотентно):
#   1. собирает образ Кортекса, если его нет (в нём утилита bft_memory.py и шаблон poh-cortex);
#   2. vault из шаблона (первый раз), импорт источников, гейт Кортекса — в контейнере,
#      без сети, файлы источников смонтированы только на чтение;
#   3. история памяти — локальный git в BFT_MEMORY_DIR (без remote: там корпоративные данные);
#   4. без --refresh: CORTEX_VAULT в harness/.env → память, пересоздаёт сервис cortex,
#      ставит таймер systemd --user bft-memory-refresh (раз в сутки — тот же скрипт с --refresh).
#
# Память видит заказчик (контуры проверки, зоны) и модель полного БФТ: импорт вырезает
# IP-адреса, почты, телефоны, длинные токены и строки «пароль: …».
set -euo pipefail

REFRESH=0
for arg in "$@"; do
  case "$arg" in
    --refresh) REFRESH=1 ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    *) echo "Неизвестный аргумент: $arg" >&2; exit 2 ;;
  esac
done
[ "$(id -u)" != 0 ] || { echo "Запускать под пользователем сервера, не под root" >&2; exit 1; }

PORTAL=${PORTAL_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}
HARNESS=$PORTAL/harness
ENV_FILE=$HARNESS/.env
export PATH="$HOME/.orbstack/bin:$PATH"
env_get() { [ -f "$ENV_FILE" ] && grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2- | sed -E "s/^[\"'](.*)[\"']\$/\\1/" || true; }
home_path() { case "$1" in "") ;; /*|~*) echo "✗ $2: путь от домашнего каталога, без ~ и «/» в начале" >&2; exit 1 ;; *) printf '%s/%s' "$HOME" "$1" ;; esac; }

MEM_REL=${BFT_MEMORY_DIR:-$(env_get BFT_MEMORY_DIR)}
[ -n "$MEM_REL" ] || { echo "✗ Не задан BFT_MEMORY_DIR (harness/deploy/server.env)" >&2; exit 1; }
MEM=$(home_path "$MEM_REL" BFT_MEMORY_DIR)
GLOSSARY=$(home_path "${BFT_MEMORY_GLOSSARY:-$(env_get BFT_MEMORY_GLOSSARY)}" BFT_MEMORY_GLOSSARY)
ITMAP=$(home_path "${BFT_MEMORY_ITMAP:-$(env_get BFT_MEMORY_ITMAP)}" BFT_MEMORY_ITMAP)
CURATED=$(home_path "${BFT_MEMORY_CURATED:-$(env_get BFT_MEMORY_CURATED)}" BFT_MEMORY_CURATED)
IFS=, read -r -a BFT_REL <<< "${BFT_MEMORY_BFT:-$(env_get BFT_MEMORY_BFT)}"

export COMPOSE_FILE=$HARNESS/docker-compose.yml:$HARNESS/docker-compose.server.yml COMPOSE_PROJECT_NAME=poh-bft-portal
IMAGE=poh-cortex:local
if ! docker image inspect "$IMAGE" > /dev/null 2>&1 || [ "$REFRESH" = 0 ]; then
  echo "▸ образ Кортекса"
  docker build --network host -q -t "$IMAGE" "$HARNESS/cortex" > /dev/null
fi

mkdir -p "$MEM"
chmod 755 "$MEM"
chmod 700 "$(dirname "$MEM")" 2>/dev/null || true

# Источники — каждый файл отдельно, только на чтение; в контейнере нет сети.
MOUNTS=(-v "$MEM:/memory")
STEPS=("python3 /opt/bft_memory.py init /memory --name bft-creator")
if [ -n "$GLOSSARY" ]; then
  if [ -f "$GLOSSARY" ]; then MOUNTS+=(-v "$GLOSSARY:/src/glossary.json:ro"); STEPS+=("python3 /opt/bft_memory.py glossary /memory /src/glossary.json")
  else echo "⚠ нет словаря $GLOSSARY — пропускаю"; fi
fi
if [ -n "$ITMAP" ]; then
  if [ -f "$ITMAP" ]; then MOUNTS+=(-v "$ITMAP:/src/it-map.md:ro"); STEPS+=("python3 /opt/bft_memory.py doc /memory /src/it-map.md --id sys-it-infra --nexus landscape --type system-component --title 'Внутренняя IT-инфраструктура: трекер задач, вики, репозитории, отчёты автотестов, мониторинг'")
  else echo "⚠ нет IT-карты $ITMAP — пропускаю"; fi
fi
BFT_ARGS=""
for rel in "${BFT_REL[@]}"; do
  [ -n "$rel" ] || continue
  name=""
  case "$rel" in *=*) name=${rel%%=*}.md; rel=${rel#*=} ;; esac
  file=$(home_path "$rel" BFT_MEMORY_BFT)
  if [ -f "$file" ]; then
    name=${name:-$(basename "$file")}
    MOUNTS+=(-v "$file:/src/bft/$name:ro"); BFT_ARGS+=" /src/bft/$name"
  else echo "⚠ нет БФТ $file — пропускаю"; fi
done
[ -z "$BFT_ARGS" ] || STEPS+=("python3 /opt/bft_memory.py bft /memory$BFT_ARGS")
if [ -n "$CURATED" ]; then
  if [ -d "$CURATED" ]; then MOUNTS+=(-v "$CURATED:/src/curated:ro"); STEPS+=("python3 /opt/bft_memory.py curated /memory /src/curated")
  else echo "⚠ нет каталога разбора $CURATED — пропускаю"; fi
fi
STEPS+=("python3 /opt/bft_memory.py check /memory")

echo "▸ память bft-creator: $MEM"
SCRIPT=$(printf '%s && ' "${STEPS[@]}")
docker run --rm --network none --user "$(id -u):$(id -g)" "${MOUNTS[@]}" "$IMAGE" sh -c "set -e; ${SCRIPT% && }"

# История памяти — локально, без remote.
if [ ! -d "$MEM/.git" ]; then git -C "$MEM" init -q && printf 'bin/__pycache__/\n*.tmp\n' > "$MEM/.gitignore"; fi
git -C "$MEM" add -A
if ! git -C "$MEM" diff --cached --quiet; then
  git -C "$MEM" -c user.name=bft-creator -c user.email=bft-creator@localhost commit -q -m "память bft-creator: импорт $(date +%F)"
  echo "✓ изменения памяти записаны в историю ($(git -C "$MEM" rev-parse --short HEAD))"
else
  echo "✓ память не изменилась"
fi

[ "$REFRESH" = 1 ] && exit 0

# Подключение к Кортексу портала.
touch "$ENV_FILE" && chmod 600 "$ENV_FILE"
grep -v '^CORTEX_VAULT=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
printf 'CORTEX_VAULT=%s\n' "$MEM" >> "$ENV_FILE.tmp"
mv "$ENV_FILE.tmp" "$ENV_FILE" && chmod 600 "$ENV_FILE"
(cd "$HARNESS" && docker compose up -d --force-recreate cortex > /dev/null)
C=$(cd "$HARNESS" && docker compose ps -q cortex)
for _ in $(seq 1 30); do
  health=$(docker exec "$C" python3 -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8095/health', timeout=3).read().decode())" 2>/dev/null || true)
  [ -n "$health" ] && break
  sleep 1
done
echo "▸ Кортекс: $health"
case "$health" in *'"demo": false'*) ;; *) echo "✗ Кортекс не видит память" >&2; exit 1 ;; esac

# Ежесуточное обновление из тех же источников.
UNIT_DIR=$HOME/.config/systemd/user
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/bft-memory-refresh.service" <<EOF
[Unit]
Description=Память bft-creator: обновить из источников (ADR-0016)

[Service]
Type=oneshot
ExecStart=/usr/bin/env bash $HARNESS/deploy/install-bft-memory.sh --refresh
EOF
cat > "$UNIT_DIR/bft-memory-refresh.timer" <<EOF
[Unit]
Description=Память bft-creator: обновление раз в сутки

[Timer]
OnCalendar=*-*-* 06:30:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now bft-memory-refresh.timer > /dev/null
echo "✓ таймер bft-memory-refresh: $(systemctl --user show bft-memory-refresh.timer -p NextElapseUSecRealtime --value)"
echo "✓ память bft-creator подключена к Кортексу портала"
