#!/usr/bin/env bash
# Установка ключа Z.AI (GLM) в автономную систему БФТ — без онбординга в UI.
#
#   ./set-key.sh <ключ>            # ключ формата id.secret
#   ./set-key.sh                   # спросит ключ с вводом (не печатается)
#   ./set-key.sh --check-only <ключ>   # только проверить, ничего не менять
#
# Что делает: проверяет форму → живой запрос к Z.AI (каталог моделей, без
# траты токенов) → пишет ZAI_API_KEY в .env → снимает demo-переопределения
# (LLM_BASE_URL/LLM_API_KEY от llm-demo, если поднимали --demo) → пересоздаёт
# harness-web и коробку с новым env → печатает свежую ссылку с токеном.
set -euo pipefail
cd "$(dirname "$0")"

KEY="${2:-${1:-}}"
CHECK_ONLY=0
[ "${1:-}" = "--check-only" ] && CHECK_ONLY=1
if [ -z "$KEY" ] && [ "$CHECK_ONLY" = "1" ]; then echo "ключ не передан" >&2; exit 2; fi
if [ -z "$KEY" ]; then
  printf 'Вставьте ключ Z.AI (ввод не печатается): '
  read -rs KEY </dev/tty 2>/dev/null || read -r KEY
  echo
fi
KEY="$(printf '%s' "$KEY" | tr -d '[:space:]')"

# ── 1. Форма ключа: id.secret, две hex-части (та же валидация, что в UI) ───────
if ! printf '%s' "$KEY" | grep -qE '^[0-9a-f]{16,}\.[0-9a-f]{16,}$'; then
  echo "✗ Ключ не похож на ключ Z.AI: ожидается форма id.secret (две hex-части через точку)."
  echo "  Возьмите ключ в консоли Z.AI: https://z.ai/manage-apikey/apikey-list"
  exit 1
fi
echo "✓ форма ключа: ${KEY%%.*}.${KEY#*.}" | sed 's/\.[0-9a-f]*$/.<секрет>/'

# ── 2. Живая проверка: каталог моделей (токены не тратятся) ──────────────────
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
  -H "Authorization: Bearer $KEY" https://api.z.ai/api/paas/v4/models || echo 000)"
case "$CODE" in
  200) echo "✓ Z.AI принял ключ (каталог моделей отвечает)" ;;
  401|403) echo "✗ Z.AI отклонил ключ ($CODE): проверьте значение в консоли Z.AI"; exit 1 ;;
  000) echo "⚠ Z.AI недоступен (сеть/прокси): сохраняю без проверки" ;;
  *) echo "⚠ Z.AI ответил $CODE: сохраняю, проверьте ключ позже" ;;
esac
[ "$CHECK_ONLY" = "1" ] && { echo "(--check-only: ничего не меняю)"; exit 0; }

# ── 3. .env: ключ + снятие demo-остатков ─────────────────────────────────────
[ -f .env ] || cp .env.example .env
set_kv() {
  if grep -q "^${1}=" .env; then sed -i.bak "s|^${1}=.*|${1}=${2}|" .env
  else printf '%s=%s\n' "$1" "$2" >> .env; fi
  rm -f .env.bak
}
drop_kv() { sed -i.bak "/^${1}=/d" .env && rm -f .env.bak; }

set_kv ZAI_API_KEY "$KEY"
echo "✓ ZAI_API_KEY записан в harness/.env"
# demo-профиль оставлял коробку на двойнике: возвращаем на настоящий Z.AI
# (умолчания compose: LLM_BASE_URL=api.z.ai, LLM_API_KEY←ZAI_API_KEY).
drop_kv LLM_BASE_URL
drop_kv LLM_API_KEY
grep -q '^LLM_MODEL=' .env || set_kv LLM_MODEL "glm-4.7"
echo "✓ demo-переопределения сняты; модель коробки: $(grep '^LLM_MODEL=' .env | cut -d= -f2)"

# ── 4. Пересоздать сервисы с новым env (тома и данные не трогаем) ────────────
echo "▸ Пересоздаю harness-web и коробку с ключом…"
export PATH="$HOME/.orbstack/bin:$PATH"
docker compose up -d --force-recreate harness-web box-worker box-mcp >/dev/null 2>&1

# ── 5. Свежая ссылка с токеном ────────────────────────────────────────────────
URL=""
for i in $(seq 1 45); do
  URL="$(docker compose logs harness-web 2>/dev/null | grep -oE 'https?://[^ "?]+\?token=[A-Za-z0-9._%-]+' | tail -1 | sed -E 's|https?://[^/]+|http://127.0.0.1:3080|' || true)"
  H="$(docker compose ps harness-web --format '{{.Health}}' 2>/dev/null)"
  [ -n "$URL" ] && [ "$H" = "healthy" ] && break
  sleep 2
done
echo
if [ -n "$URL" ]; then
  echo "$URL" > .last-url
  echo "✓ Готово. Открывайте: $URL"
  echo "  — онбординг больше не появится (пройден через CLI), интейк ждёт;"
  echo "  — fast-прогон теперь идёт на glm-5-turbo (провайдер zai)."
  command -v open >/dev/null && open "$URL" || true
else
  echo "⚠ Ссылка не появилась за 90с: docker compose logs harness-web"
fi
