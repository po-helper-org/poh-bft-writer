#!/bin/bash
# Самотест bft-blueprint: линтер ловит каждый код на фикстурах, эталон проходит строго,
# рендерер не пишет файлов по сломанному документу, стрелки не пересекают чужие карточки.
# Запуск из корня репозитория: bash skills/bft-blueprint/scripts/test-bft-blueprint.sh
set -u

DIR="skills/bft-blueprint"
LINT="$DIR/scripts/bft-blueprint-lint.py"
RENDER="$DIR/scripts/bft-blueprint-render.py"
FIX="$DIR/scripts/fixtures"
GOLD="$DIR/examples/golden_blueprint.md"
fails=0
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

ok()   { echo "ok    $1"; }
fail() { echo "FAIL  $1"; fails=$((fails + 1)); }

expect_codes() {  # <имя> <ожидаемый rc> <файл> <коды через пробел> [доп. аргументы линтера]
  local name="$1" rc_want="$2" file="$3" codes="$4"; shift 4
  local out rc
  out="$(python3 "$LINT" "$file" "$@" 2>&1)"; rc=$?
  [ "$rc" -eq "$rc_want" ] || { fail "$name: код выхода $rc, ожидался $rc_want"; return; }
  for c in $codes; do
    grep -q " $c " <<<"$out" || { fail "$name: нет $c в выводе"; return; }
  done
  ok "$name"
}

expect_codes "эталон проходит строго"        0 "$GOLD" "" --strict
expect_codes "эталон без сверки с БФТ"       0 "$GOLD" "" --no-source
expect_codes "структура: разделы и дорожки"  1 "$FIX/broken_structure.md" "BP002 BP006"
expect_codes "смысл: ошибки"                 1 "$FIX/broken_semantics.md" "BP011 BP012 BP013 BP014 BP016 BP017"
expect_codes "смысл: предупреждения"         1 "$FIX/broken_semantics.md" "BP018 BP020 BP021 BP022 BP023"
expect_codes "БФТ-источника нет"             1 "$GOLD" "BP015" --source "$tmp/нет-такого.md"
expect_codes "предупреждения печатаются вместе с ошибками" 1 "$FIX/broken_semantics.md" "BP020"

# предупреждения сами по себе валят только со --strict
sed 's/^source_rev: .*/source_rev: 000000000000/' "$GOLD" > "$tmp/stale.md"
python3 "$LINT" "$tmp/stale.md" --source "$DIR/examples/../../bft-deep-swarm/examples/golden_deep_document.md" >/dev/null 2>&1 \
  && ok "устаревший source_rev — только предупреждение" || fail "устаревший source_rev не должен валить без --strict"
python3 "$LINT" "$tmp/stale.md" --source "$DIR/examples/../../bft-deep-swarm/examples/golden_deep_document.md" --strict >/dev/null 2>&1 \
  && fail "--strict должен валить на предупреждении" || ok "--strict валит на предупреждении"

# латинские К/С вместо кириллических не рвут связи
sed 's/К\([0-9]\)/K\1/g; s/С\([0-9]\)/C\1/g' "$GOLD" > "$tmp/latin.md"
python3 "$LINT" "$tmp/latin.md" --source "$DIR/../bft-deep-swarm/examples/golden_deep_document.md" >/dev/null 2>&1 \
  && ok "латинские двойники ID нормализуются" || fail "латинские К/С в ID сломали разбор"

# рендер: эталон собирается, битый документ — нет
python3 "$RENDER" "$GOLD" --out-dir "$tmp/out" >/dev/null 2>&1 && ok "эталон отрендерен" || fail "эталон не отрендерился"
svg="$tmp/out/golden_blueprint.svg"; page="$tmp/out/golden_blueprint.html"
[ "$(head -c 5 "$svg" 2>/dev/null)" = "<?xml" ] && ok "svg: корректный заголовок" || fail "svg: нет XML-заголовка"
[ "$(grep -o 'class="card ' "$svg" | wc -l)" -eq 19 ] && ok "svg: 19 карточек" || fail "svg: число карточек не 19"
[ "$(grep -o 'class="link ' "$svg" | wc -l)" -ge 21 ] && ok "svg: стрелки на месте" || fail "svg: стрелок меньше 21 (+ легенда)"
grep -q "Покрытие требований БФТ" "$page" && grep -q "Что реализовать на каждом слое" "$page" \
  && ok "html: разделы страницы" || fail "html: нет разделов страницы"
if grep -Eq 'src="https?://|href="https?://' "$page"; then fail "html: внешние ресурсы (страница должна быть автономной)"; else ok "html: без внешних ресурсов"; fi
cmp -s "$svg" "$DIR/examples/golden_blueprint.svg" \
  && ok "svg: совпадает с examples/golden_blueprint.svg" \
  || fail "svg: разошёлся с examples/golden_blueprint.svg — пересобери эталон: python3 $RENDER $GOLD --out-dir <каталог> и скопируй .svg"
python3 -c "import xml.dom.minidom,sys; xml.dom.minidom.parse(sys.argv[1])" "$svg" 2>/dev/null \
  && ok "svg: well-formed XML" || fail "svg: не well-formed XML"

python3 "$RENDER" "$FIX/broken_semantics.md" --out-dir "$tmp/bad" >/dev/null 2>&1; rc=$?
{ [ "$rc" -eq 1 ] && [ ! -e "$tmp/bad" ]; } && ok "битый документ: код 1, файлов нет" || fail "битый документ отрендерился или код не 1"

# стрелки не пересекают чужие карточки
python3 - "$RENDER" "$GOLD" <<'PY' && ok "маршруты: ни одна стрелка не задевает чужую карточку" || fail "маршруты: стрелка пересекает карточку"
import importlib.util, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("r", sys.argv[1]); r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
bp = r.lint.run(Path(sys.argv[2]), None, False)
lanes, boxes, x0, width, hdr_h, lane_geo, bnd, y_end = r.layout(bp)
bad = []
for lk in bp.links:
    s, d = boxes[lk.src], boxes[lk.dst]
    pts = r.route(s, d, boxes, x0, lane_geo)
    others = [b.rect for b in boxes.values() if b is not s and b is not d]
    if r._cost(pts, others):
        bad.append(f"{lk.src}->{lk.dst}")
if bad:
    print("пересекают:", ", ".join(bad), file=sys.stderr); sys.exit(1)
PY

echo
[ "$fails" -eq 0 ] && echo "bft-blueprint: все проверки пройдены" || echo "bft-blueprint: провалено проверок — $fails"
exit "$fails"
