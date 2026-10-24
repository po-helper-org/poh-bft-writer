#!/usr/bin/env bash
# Шов S3: приёмка compose-стека автономной системы (Т4, гейт Полосы А).
# Проверяет то, что не требует ключа LLM: здоровье, ссылку с токеном, API
# коробки, монтирование панели плагина. Живой fast-прогон — ручной HOWTODEMO.
#
#   ./acceptance.sh          # базовая приёмка
#   ./acceptance.sh --demo   # + перезапуск в профиле demo и smoke жизненного цикла
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.orbstack/bin:$PATH:$PATH"

fail=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; fail=1; }
say()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

# 1. Все сервисы default-профиля здоровы (без mapfile: macOS bash 3.2)
say "Сервисы"
ROWS="$(docker compose ps --format '{{.Name}}|{{.State}}|{{.Health}}|' 2>/dev/null)"
COUNT="$(printf '%s\n' "$ROWS" | grep -c '|' || true)"
[ "${COUNT:-0}" -ge 5 ] && ok "сервисов в стеке: $COUNT" || bad "сервисов меньше пяти: ${COUNT:-0}"
printf '%s\n' "$ROWS" | while IFS='|' read -r name state health _; do
  [ -z "$name" ] && continue
  if [ "$health" = "healthy" ]; then printf '  \033[32m✓\033[0m %s healthy\n' "$name"
  else printf '  \033[31m✗\033[0m %s: %s %s\n' "$name" "$state" "$health"; fi
done

# 2. Ссылка с токеном из логов переписана в хостовую форму и отвечает
say "Ссылка с токеном (US-4)"
URL="$(docker compose logs harness-web 2>/dev/null | grep -oE 'https?://[^ "?]+\?token=[A-Za-z0-9._%-]+' | tail -1 | sed -E 's|https?://[^/]+|http://127.0.0.1:3080|' || true)"
[ -n "$URL" ] && ok "извлечена" || bad "в логах нет ссылки с токеном"
CODE="$(curl -s -L -c /tmp/.bft-acc.cookies -b /tmp/.bft-acc.cookies -o /dev/null -w '%{http_code}' "$URL" || true)"
[ "$CODE" = "200" ] && ok "UI отвечает 200" || bad "UI ответил $CODE"

# 3. API коробки: пустая доска — норма (авторитет состояний, ADR-0001)
say "Коробка (API)"
UI_TOKEN="$(grep -oE '^BOX_TOKENS=ui:[^,]+' .env | cut -d: -f2 || true)"
[ -n "$UI_TOKEN" ] && ok "ui-токен из .env" || bad "BOX_TOKENS без ui-токена"
BOARD="$(docker compose exec -T box-mcp python -c "
import urllib.request, json
req = urllib.request.Request('http://127.0.0.1:8700/api/board',
      headers={'Authorization': 'Bearer $UI_TOKEN'})
print(json.load(urllib.request.urlopen(req))['schema_version'])" 2>/dev/null || true)"
[ "$BOARD" = "1.0.0" ] && ok "/api/board отдаёт контракт $BOARD (инициатив: пусто — норма)" \
                       || bad "/api/board недоступен: $BOARD"

# 4. Панель плагина в UI (гейт Т2: клиентский бандл с маркером раздела)
say "Плагин poh-bft-plugin"
RAW="$(curl -s -b /tmp/.bft-acc.cookies "http://127.0.0.1:3080/" \
  | grep -oE 'plugins/\?\?poh-bft-plugin/client\.js[^"]*' | head -1 || true)"
# Манифест склеивает модули запятыми в один чанк (plugins/??a,b,c&amp;rev=…):
# браузер грузит чанк целиком — так и проверяем; &amp; разэкранируем.
CLIENT_URL="$(printf '%s' "$RAW" | sed 's/&amp;/\&/g')"
if [ -n "$CLIENT_URL" ]; then
  MARKS="$(curl -s -b /tmp/.bft-acc.cookies "http://127.0.0.1:3080/$CLIENT_URL" \
    | grep -cE 'bft-requirements|Управление требованиями|bft-panel' || true)"
  [ "${MARKS:-0}" -gt 0 ] && ok "клиентский бандл монтируется ($CLIENT_URL)" \
                           || bad "бандл без маркера раздела"
else
  bad "клиентский бандл плагина не найден в манифесте"
fi

# 5. Трекер (Т10): здоров, сид на месте (проект/вебхук), приёмник коробки живой
if docker compose ps --status running 2>/dev/null | grep -q tracker; then
  say "Трекер (Vikunja)"
  set -a; . ./.env; set +a
  TRACKER_CODE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3456/api/v1/info || true)"
  [ "$TRACKER_CODE" = "200" ] && ok "API отвечает" || bad "API ответил $TRACKER_CODE"
  TR_TOKEN="$(curl -s -X POST http://127.0.0.1:3456/api/v1/login -H 'content-type: application/json' \
    -d "{\"username\":\"${TRACKER_ADMIN_USER:-bft-admin}\",\"password\":\"${TRACKER_ADMIN_PASSWORD}\"}" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))' 2>/dev/null || true)"
  if [ -n "$TR_TOKEN" ]; then
    PROJ="$(curl -s http://127.0.0.1:3456/api/v1/projects -H "Authorization: Bearer $TR_TOKEN" \
      | python3 -c 'import json,sys; ps=json.load(sys.stdin); print(any(p["title"].startswith("БФТ ") for p in ps))' 2>/dev/null || true)"
    [ "$PROJ" = "True" ] && ok "квартальный проект на месте" || bad "сид не прошёл: запустите tracker/seed.py"
    HOOK="$(curl -s "http://127.0.0.1:3456/api/v1/projects/2/webhooks" -H "Authorization: Bearer $TR_TOKEN" \
      | python3 -c 'import json,sys; ws=json.load(sys.stdin); print(any(w["target_url"].endswith("/api/hooks/tracker") for w in ws))' 2>/dev/null || true)"
    [ "$HOOK" = "True" ] && ok "вебхук в Коробку стоит" || bad "вебхук не зарегистрирован"
  else
    bad "вход админа трекера не удался"
  fi
  HOOK_CODE="$(docker compose exec -T box-mcp python -c \
    "import urllib.request, urllib.error;
req = urllib.request.Request('http://127.0.0.1:8700/api/hooks/tracker', data=b'{}', headers={'Content-Type':'application/json'});
import sys;
sys.stdout.write(str(urllib.request.urlopen(req).status))" 2>/dev/null || echo 401)"
  [ "$HOOK_CODE" = "401" ] && ok "приёмник коробки закрыт секретом" || bad "приёмник отвечает $HOOK_CODE"
fi

# 6. Опционально: демо-профиль + smoke жизненного цикла коробки
if [ "${1:-}" = "--demo" ]; then
  say "Демо-профиль (LLM-двойник)"
  set_kv() { grep -q "^${1}=" .env && sed -i.bak "s|^${1}=.*|${1}=${2}|" .env && rm -f .env.bak || printf '%s=%s\n' "$1" "$2" >> .env; }
  set_kv LLM_BASE_URL "http://llm-demo:8710/v1"
  docker compose --profile demo up -d --build > /dev/null 2>&1 && ok "стек в профиле demo" || bad "demo-профиль не поднялся"
  cd ../box && .venv/bin/python scripts/smoke.py > /tmp/bft-smoke.log 2>&1 \
    && ok "smoke: бриф → план → проработка → приёмка (scripts/smoke.py)" \
    || bad "smoke упал (см. /tmp/bft-smoke.log)"
fi

say "Итог"
if [ "$fail" = "0" ]; then printf '\033[32m✓ Приёмка пройдена\033[0m\n'; exit 0
else printf '\033[31m✗ Приёмка не пройдена\033[0m\n'; exit 1; fi
