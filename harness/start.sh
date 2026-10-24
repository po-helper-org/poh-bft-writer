#!/usr/bin/env bash
# Подъём автономной системы БФТ «под ключ» (Т3): секреты → compose up →
# ссылка с токеном dsh из логов → браузер.
#
#   ./start.sh                # обычный подъём (нужен ZAI_API_KEY в .env или онбординг)
#   ./start.sh --demo         # профиль demo: LLM-двойник без ключа
#   ./start.sh --debug        # + temporal-ui :8233
#   ./start.sh --no-open      # не открывать браузер
set -euo pipefail
cd "$(dirname "$0")"

PROFILE_ARGS=()
NO_OPEN=0
for arg in "$@"; do
  case "$arg" in
    --demo)  PROFILE_ARGS+=(--profile demo) ;;
    --debug) PROFILE_ARGS+=(--profile debug) ;;
    --no-open) NO_OPEN=1 ;;
    *) echo "Неизвестный аргумент: $arg" >&2; exit 2 ;;
  esac
done

# ── 1. Секреты первого запуска (коробочность: .env руками не правим) ──────────
if [ ! -f .env ]; then
  cp .env.example .env
fi
gen() { openssl rand -hex 24 2>/dev/null || python3 -c "import secrets;print(secrets.token_hex(24))"; }
set_kv() { # key value — дописать/заменить в .env
  if grep -q "^${1}=" .env; then sed -i.bak "s|^${1}=.*|${1}=${2}|" .env && rm -f .env.bak
  else printf '%s=%s\n' "$1" "$2" >> .env; fi
}
if ! grep -q '^POSTGRES_PASSWORD=..' .env; then
  set_kv POSTGRES_PASSWORD "$(gen)"
  echo "✓ POSTGRES_PASSWORD сгенерирован"
fi
if ! grep -q '^BOX_TOKENS=..' .env; then
  set_kv BOX_TOKENS "ui:$(gen),agent:$(gen)"
  echo "✓ BOX_TOKENS сгенерированы (ui — плагину, agent — запас агентам, ADR-0001)"
fi
# ui-токен — харнесс-контейнеру (BFT_BOX_UI_TOKEN): плагин зовёт /api/start.
UI_TOKEN_VALUE="$(grep -oE '^BOX_TOKENS=ui:[^,]+' .env | cut -d: -f2)"
if [ -n "$UI_TOKEN_VALUE" ]; then set_kv BFT_BOX_UI_TOKEN "$UI_TOKEN_VALUE"; fi
# Трекер (Т10): пароль админа, JWT-секрет, секрет вебхука в Коробку.
if ! grep -q '^TRACKER_ADMIN_PASSWORD=..' .env; then
  set_kv TRACKER_ADMIN_PASSWORD "$(gen)"
  echo "✓ TRACKER_ADMIN_PASSWORD сгенерирован"
fi
if ! grep -q '^TRACKER_JWT_SECRET=..' .env; then
  set_kv TRACKER_JWT_SECRET "$(gen)"
  echo "✓ TRACKER_JWT_SECRET сгенерирован"
fi
if ! grep -q '^TRACKER_HOOK_TOKEN=..' .env; then
  set_kv TRACKER_HOOK_TOKEN "$(gen)"
  echo "✓ TRACKER_HOOK_TOKEN сгенерирован (вебхук Трекер → Коробка)"
fi
# Шлюз Matrix (Т11): секрет регистрации Synapse генерирует сам при первом
# старте — извлекаем из homeserver.yaml (том матрикса) после подъёма ниже.
# Демо-профиль: коробка идёт в LLM-двойника, ключ не нужен.
# ${ARR[@]+...} — гарда пустого массива: bash 3.2 (macOS) под set -u падает на "${ARR[@]}".
if printf '%s\n' ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} 2>/dev/null | grep -q demo; then
  set_kv LLM_BASE_URL "http://llm-demo:8710/v1"
  set_kv LLM_API_KEY "demo"   # двойник ключа не проверяет, продюсер — требует
fi

# ── 2. Подъём ──────────────────────────────────────────────────────────────────
echo "▸ Поднимаю систему…"
docker compose ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} up -d --build

# ── 3. Ждём health и достаём ссылку с токеном ─────────────────────────────────
echo "▸ Жду здоровья сервисов…"
for i in $(seq 1 90); do
  ST="$(docker compose ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} ps --format '{{.Name}} {{.Health}}' 2>/dev/null)"
  UNHEALTHY="$(echo "$ST" | grep -cv '(healthy)$' || true)"
  URL="$(docker compose logs harness-web 2>/dev/null | grep -oE 'https?://[^ "?]+\?token=[A-Za-z0-9._%-]+' | tail -1 | sed -E 's|https?://[^/]+|http://127.0.0.1:3080|' || true)"
  [ -n "$URL" ] && [ "$UNHEALTHY" = "0" ] && break
  sleep 2
done

if [ -z "$URL" ]; then
  echo "✗ Ссылка с токеном не появилась за 3 минуты. Смотрите:" >&2
  echo "    docker compose logs harness-web" >&2
  exit 1
fi

echo "$URL" > .last-url
echo "✓ Система поднята:"
echo "    $URL"

# Сид Трекера (Т10): админ/проект/лейблы/вебхук; ошибки — предупреждением,
# не гробят подъём (трекер оживёт на повторном start.sh).
if command -v python3 >/dev/null; then
  set -a; . ./.env; set +a
  TRACKER_SEED_URL="http://127.0.0.1:3456/api/v1" python3 tracker/seed.py \
    && echo "    Трекер: http://127.0.0.1:3456 (админ: ${TRACKER_ADMIN_USER:-bft-admin})" \
    || echo "⚠ Сид Трекера не прошёл: повторите ./start.sh или tracker/seed.py вручную"

  # Шлюз (Т11): ждём health Synapse (миграции с чистого тома идут минуты),
  # извлекаем сгенерированный секрет регистрации, затем сид агента/заказчика.
  for i in $(seq 1 60); do
    MH="$(docker compose ps matrix --format '{{.Health}}' 2>/dev/null)"
    [ "$MH" = "healthy" ] && break
    sleep 3
  done
  # tr -d '[:space:]' обязателен: docker exec тянет \r, и HMAC с ним не сходится.
  REG_SECRET_VALUE="$(docker compose exec -T matrix sh -c "grep -m1 '^registration_shared_secret:' /data/homeserver.yaml" 2>/dev/null | sed 's/^[^:]*: *//' | tr -d '\"[:space:]')"
  if [ -n "$REG_SECRET_VALUE" ]; then set_kv MATRIX_REG_SECRET "$REG_SECRET_VALUE"; fi
  # Шлюз (Т11): агент + демо-заказчик + smoke-комната; после записи токена —
  # пересоздаём воркер/приёмник, чтобы env MATRIX_AGENT_TOKEN доехал (Т12).
  if [ -n "$REG_SECRET_VALUE" ] && MATRIX_SEED_URL="http://127.0.0.1:8008" python3 matrix/seed.py; then
    echo "    Шлюз: Element http://127.0.0.1:8090, заказчик: customer-demo"
    grep -q '^MATRIX_AGENT_TOKEN=..' .env && docker compose up -d box-worker box-mcp > /dev/null 2>&1 || true
  else
    echo "⚠ Сид Шлюза не прошёл: повторите ./start.sh или matrix/seed.py вручную"
  fi
fi
grep -q '^ZAI_API_KEY=..' .env || echo "⚠  Ключа Z.AI нет: fast-прогон не заработает, пока не пройдёте онбординг (US-5–8)."
if [ "$NO_OPEN" = "0" ] && command -v open >/dev/null; then open "$URL"; fi
