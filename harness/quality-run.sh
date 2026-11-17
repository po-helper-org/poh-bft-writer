#!/usr/bin/env bash
# Прогон качества полного БФТ на фикстурах (план качества, C0).
#
#   ./harness/quality-run.sh <outDir> [--live] [имя …]
#
# Фикстуры — .bft/quality/fixtures/<имя>/ (primary.json, необязательно
# sources.md, context_map.md, intake.json). Скрипт копирует их в том портала
# (/data/quality/<имя>/, от пользователя контейнера), параллельно зовёт
# POST /api/customer-form.qualityRun (только администратор: кука portal_admin
# из ADMIN_PASSWORD в harness/.env — не печатается) и забирает
# /data/quality/<имя>/out/ в <outDir>/<имя>/ (fast.md, sources.md, <имя>.md,
# deep.json, metrics.json, primary.json) плюс ответ маршрута — response.json.
#
#   --live            разведка по настоящим Jira/Confluence вместо sources.md фикстуры
#   PORTAL_URL=…      адрес портала (по умолчанию http://127.0.0.1:3080; под префиксом —
#                     http://127.0.0.1:3090/bft, без «/» на конце)
#   QUALITY_DATE=…    дата synced в fast (YYYY-MM-DD) — для сравнения раундов без шума
#
# Портал должен быть поднят с текущим кодом (пересборку делает не этот скрипт).
set -euo pipefail
export PATH="$HOME/.orbstack/bin:$PATH"

HARNESS="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HARNESS/.." && pwd)"
FIXTURES="$REPO/.bft/quality/fixtures"
COMPOSE=(docker compose -f "$HARNESS/docker-compose.yml")
PORTAL_URL="${PORTAL_URL:-http://127.0.0.1:3080}"

[ $# -ge 1 ] || { echo "использование: $0 <outDir> [--live] [имя …]" >&2; exit 2; }
OUT="$1"; shift
RECON=fixture
NAMES=()
for arg in "$@"; do
  case "$arg" in
    --live) RECON=live ;;
    *) NAMES+=("$arg") ;;
  esac
done
if [ ${#NAMES[@]} -eq 0 ]; then
  for dir in "$FIXTURES"/*/; do [ -f "$dir/primary.json" ] && NAMES+=("$(basename "$dir")"); done
fi
[ ${#NAMES[@]} -gt 0 ] || { echo "нет фикстур в $FIXTURES" >&2; exit 2; }
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

# Кука администратора: HMAC-SHA256(ADMIN_PASSWORD, 'portal-admin-v1') hex — как admin.ts.
# Пароль и кука — только в переменных и stdin, в вывод и argv не попадают.
ENV_FILE="$HARNESS/.env"
[ -f "$ENV_FILE" ] || { echo "нет $ENV_FILE" >&2; exit 2; }
ADMIN_PASSWORD="$(grep -E '^ADMIN_PASSWORD=' "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -E "s/^[\"'](.*)[\"']\$/\\1/" || true)"
[ -n "${ADMIN_PASSWORD// /}" ] || { echo "ADMIN_PASSWORD не задан в harness/.env — маршрут прогона закрыт" >&2; exit 2; }
COOKIE="$(ADMIN_PASSWORD="$ADMIN_PASSWORD" python3 -c 'import hashlib, hmac, os; print(hmac.new(os.environ["ADMIN_PASSWORD"].strip().encode(), b"portal-admin-v1", hashlib.sha256).hexdigest())')"
unset ADMIN_PASSWORD

# Фикстуры → том портала (от пользователя контейнера).
for name in "${NAMES[@]}"; do
  src="$FIXTURES/$name"
  [ -f "$src/primary.json" ] || { echo "нет $src/primary.json" >&2; exit 2; }
  "${COMPOSE[@]}" exec -T customer-web sh -c "rm -rf '/data/quality/$name' && mkdir -p '/data/quality/$name'"
  for file in primary.json sources.md context_map.md intake.json approval.json; do
    [ -f "$src/$file" ] || continue
    "${COMPOSE[@]}" exec -T customer-web sh -c "cat > '/data/quality/$name/$file'" < "$src/$file"
  done
  echo "→ $name: фикстура в /data/quality/$name ($RECON)"
done

# Прогоны — параллельно; ответ каждого — в <outDir>/<имя>/response.json.
body() {
  local date=""
  [ -n "${QUALITY_DATE:-}" ] && date=", \"date\": \"$QUALITY_DATE\""
  printf '{"fixture": "%s", "recon": "%s"%s}' "$1" "$RECON" "$date"
}
PIDS=()
for name in "${NAMES[@]}"; do
  mkdir -p "$OUT/$name"
  (
    code="$(printf 'Cookie: portal_admin=%s\n' "$COOKIE" | curl -sS -o "$OUT/$name/response.json" -w '%{http_code}' \
      --max-time 2400 -H @- -H 'content-type: application/json' --data-binary "$(body "$name")" \
      "$PORTAL_URL/api/customer-form.qualityRun" || echo 000)"
    echo "← $name: HTTP $code"
    [ "$code" = 200 ]
  ) &
  PIDS+=($!)
done
FAILED=0
for pid in "${PIDS[@]}"; do wait "$pid" || FAILED=$((FAILED + 1)); done
unset COOKIE

# Итоги out/ → <outDir>/<имя>/.
for name in "${NAMES[@]}"; do
  files="$("${COMPOSE[@]}" exec -T customer-web sh -c "ls '/data/quality/$name/out' 2>/dev/null" || true)"
  for file in $files; do
    "${COMPOSE[@]}" exec -T customer-web sh -c "cat '/data/quality/$name/out/$file'" > "$OUT/$name/$file"
  done
  if [ -f "$OUT/$name/metrics.json" ]; then
    python3 - "$OUT/$name/metrics.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
k = m.get("metrics", {})
print(f"  {m.get('fixture')}: {m.get('stage')}, попыток {m.get('attempts')}, lint_first_pass={k.get('lint_first_pass')}, "
      f"coverage_demo={k.get('coverage_demo')}, dangling_ids={k.get('dangling_ids')}, leak_count={k.get('leak_count')}")
PY
  else
    echo "  $name: out/ нет — см. $OUT/$name/response.json и docker compose logs customer-web"
  fi
done
echo "Итоги: $OUT"
[ "$FAILED" -eq 0 ] || { echo "сбоев: $FAILED" >&2; exit 1; }
