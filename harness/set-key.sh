#!/usr/bin/env bash
# Установка ключа Z.AI (GLM) в автономную систему БФТ — без онбординга в UI.
#
#   ./set-key.sh <ключ>                # ключ формата id.secret
#   ./set-key.sh                       # спросит ключ с вводом (не печатается)
#   ./set-key.sh --from-pi             # взять ключ из ~/.pi/agent/auth.json
#   ./set-key.sh --check-only <ключ|--from-pi>   # только проверить, не менять
#   ./set-key.sh --coding [ключ]       # ключ GLM Coding Plan → портал заказчика на GLM-5
#   ./set-key.sh --anthropic [ключ]    # ключ Anthropic API → портал заказчика на Claude Haiku 5.5
#
# Что делает: проверяет форму → живой запрос к Z.AI (каталог моделей, без
# траты токенов) → пишет ZAI_API_KEY в .env → снимает demo-переопределения
# (LLM_BASE_URL/LLM_API_KEY от llm-demo, если поднимали --demo) → пересоздаёт
# harness-web и коробку с новым env → печатает свежую ссылку с токеном.
set -euo pipefail
cd "$(dirname "$0")"

KEY=""
CHECK_ONLY=0
CODING=0
ANTHROPIC=0
for arg in "$@"; do
  case "$arg" in
    --from-pi) ;;   # обрабатывается ниже (после разбора всех флагов)
    --check-only) CHECK_ONLY=1 ;;
    --coding) CODING=1 ;;
    --anthropic) ANTHROPIC=1 ;;
    -*) echo "неизвестный флаг: $arg" >&2; exit 2 ;;
    *) KEY="$arg" ;;
  esac
done
# --from-pi: ключ того же pi-агента (auth.json, провайдер zai) — без
# вложенных кавычек в командной строке, копипаст не ломается.
for arg in "$@"; do
  if [ "$arg" = "--from-pi" ] && [ -z "$KEY" ]; then
    PI_AUTH="$HOME/.pi/agent/auth.json"
    [ -f "$PI_AUTH" ] || { echo "✗ нет $PI_AUTH"; exit 2; }
    KEY="$(sed -n 's/.*"key"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PI_AUTH" | head -1)"
    [ -n "$KEY" ] || { echo "✗ в $PI_AUTH не найден zai-ключ"; exit 2; }
    echo "✓ ключ взят из pi (~/.pi/agent/auth.json)"
  fi
done
if [ -z "$KEY" ]; then
  [ "$ANTHROPIC" = "1" ] && printf 'Вставьте ключ Anthropic API (ввод не печатается): ' \
    || printf 'Вставьте ключ Z.AI (ввод не печатается): '
  read -rs KEY </dev/tty 2>/dev/null || read -r KEY
  echo
fi
if [ -z "$KEY" ]; then
  printf 'Вставьте ключ Z.AI (ввод не печатается): '
  read -rs KEY </dev/tty 2>/dev/null || read -r KEY
  echo
fi
KEY="$(printf '%s' "$KEY" | tr -d '[:space:]')"

# ── --anthropic: ключ Anthropic API только для портала заказчика ─────────────
if [ "$ANTHROPIC" = "1" ]; then
  printf '%s' "$KEY" | grep -qE '^sk-ant-[A-Za-z0-9_-]{20,}$' \
    || { echo "✗ Не похоже на ключ Anthropic API (ожидается sk-ant-…): https://platform.claude.com/settings/keys"; exit 1; }
  echo "✓ форма ключа: ${KEY:0:10}….<секрет>"
  # Список моделей — без траты токенов.
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
    -H "x-api-key: $KEY" -H 'anthropic-version: 2023-06-01' https://api.anthropic.com/v1/models || echo 000)"
  case "$CODE" in
    200) echo "✓ Anthropic принял ключ (список моделей отвечает)" ;;
    401|403) echo "✗ Anthropic отклонил ключ ($CODE)"; exit 1 ;;
    000) echo "⚠ Anthropic недоступен (сеть/прокси): сохраняю без проверки" ;;
    *) echo "⚠ Anthropic ответил $CODE: сохраняю, проверьте ключ позже" ;;
  esac
  [ "$CHECK_ONLY" = "1" ] && { echo "(--check-only: ничего не меняю)"; exit 0; }
  [ -f .env ] || cp .env.example .env
  if grep -q '^ANTHROPIC_API_KEY=' .env; then sed -i.bak "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=${KEY}|" .env && rm -f .env.bak
  else printf 'ANTHROPIC_API_KEY=%s\n' "$KEY" >> .env; fi
  echo "✓ ANTHROPIC_API_KEY записан в harness/.env"
  export PATH="$HOME/.orbstack/bin:$PATH"
  docker compose up -d --force-recreate customer-web >/dev/null 2>&1
  echo "✓ Портал заказчика пересоздан: модель — Claude Haiku 5.5 (Anthropic)"
  grep -q '^PORTAL_PROVIDER=' .env && echo "⚠ в .env задан PORTAL_PROVIDER — он важнее ключа; уберите строку, чтобы портал ушёл на Anthropic"
  exit 0
fi

# ── 1. Форма ключа: id.secret, две hex-части (та же валидация, что в UI) ───────
# Реальные ключи Z.AI: id.secret из букв-цифр СМЕШАННОГО регистра (не только hex).
if ! printf '%s' "$KEY" | grep -qE '^[0-9A-Za-z_-]{16,}\.[0-9A-Za-z_-]{16,}$'; then
  echo "✗ Ключ не похож на ключ Z.AI: ожидается форма id.secret (две части через точку)."
  echo "  Возьмите ключ в консоли Z.AI: https://z.ai/manage-apikey/apikey-list"
  exit 1
fi
# В выводе — только начало id: секрет смешанного регистра прежняя маска (hex) не прятала.
echo "✓ форма ключа: ${KEY:0:6}….<секрет>"

# ── 2. Живая проверка: каталог моделей (токены не тратятся) ──────────────────
# Coding Plan — свой эндпоинт: ключ подписки платный API не принимает.
API="https://api.z.ai/api/paas/v4"
[ "$CODING" = "1" ] && API="https://api.z.ai/api/coding/paas/v4"
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
  -H "Authorization: Bearer $KEY" "$API/models" || echo 000)"
case "$CODE" in
  200) echo "✓ Z.AI принял ключ (каталог моделей отвечает)" ;;
  401|403) echo "✗ Z.AI отклонил ключ ($CODE): проверьте значение в консоли Z.AI"; exit 1 ;;
  000) echo "⚠ Z.AI недоступен (сеть/прокси): сохраняю без проверки" ;;
  *) echo "⚠ Z.AI ответил $CODE: сохраняю, проверьте ключ позже" ;;
esac
[ "$CHECK_ONLY" = "1" ] && { echo "(--check-only: ничего не меняю)"; exit 0; }

# ── --coding: только портал заказчика (провайдер zai-coding, GLM-5) ──────────
if [ "$CODING" = "1" ]; then
  [ -f .env ] || cp .env.example .env
  if grep -q '^ZAI_CODING_API_KEY=' .env; then sed -i.bak "s|^ZAI_CODING_API_KEY=.*|ZAI_CODING_API_KEY=${KEY}|" .env && rm -f .env.bak
  else printf 'ZAI_CODING_API_KEY=%s\n' "$KEY" >> .env; fi
  echo "✓ ZAI_CODING_API_KEY записан в harness/.env"
  export PATH="$HOME/.orbstack/bin:$PATH"
  docker compose up -d --force-recreate customer-web >/dev/null 2>&1
  echo "✓ Портал заказчика пересоздан: модель — GLM-5 (Z.AI Coding Plan)"
  grep -q '^PORTAL_PROVIDER=' .env && echo "⚠ в .env задан PORTAL_PROVIDER — он важнее ключа; уберите строку, чтобы портал ушёл на GLM-5"
  exit 0
fi

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
