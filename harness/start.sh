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
# Демо-профиль: коробка идёт в LLM-двойника, ключ не нужен.
if printf '%s\n' "${PROFILE_ARGS[@]}" 2>/dev/null | grep -q demo || [ "${1:-}" = "--demo" ]; then
  set_kv LLM_BASE_URL "http://llm-demo:8710/v1"
fi

# ── 2. Подъём ──────────────────────────────────────────────────────────────────
echo "▸ Поднимаю систему…"
docker compose "${PROFILE_ARGS[@]}" up -d --build

# ── 3. Ждём health и достаём ссылку с токеном ─────────────────────────────────
echo "▸ Жду здоровья сервисов…"
for i in $(seq 1 90); do
  ST="$(docker compose "${PROFILE_ARGS[@]}" ps --format '{{.Name}} {{.Health}}' 2>/dev/null)"
  UNHEALTHY="$(echo "$ST" | grep -cv '(healthy)$' || true)"
  URL="$(docker compose logs harness-web 2>/dev/null | grep -oE 'https?://127\.0\.0\.1:3080/\?token=[A-Za-z0-9._%-]+' | tail -1 || true)"
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
echo "    $URL" | tee .last-url.txt
grep -q '^ZAI_API_KEY=..' .env || echo "⚠  Ключа Z.AI нет: fast-прогон не заработает, пока не пройдёте онбординг (US-5–8)."
if [ "$NO_OPEN" = "0" ] && command -v open >/dev/null; then open "$URL"; fi
