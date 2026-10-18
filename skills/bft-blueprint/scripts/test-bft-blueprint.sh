#!/bin/bash
# Самотест bft-blueprint: линтер ловит каждый код на фикстурах, эталон проходит строго,
# рендерер не пишет файлов по сломанному документу, стрелки не пересекают чужие карточки.
# Вторая часть — история через экраны (bft-story-*), третья — карта инициативы (bft-map-*):
# те же гарантии для каждого этапа.
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

# --- история через экраны -------------------------------------------------------------
SLINT="$DIR/scripts/bft-story-lint.py"
SRENDER="$DIR/scripts/bft-story-render.py"
SGOLD="$DIR/examples/golden_story.md"

expect_story() {  # <имя> <ожидаемый rc> <файл> <коды через пробел> [доп. аргументы линтера]
  local name="$1" rc_want="$2" file="$3" codes="$4"; shift 4
  local out rc
  out="$(python3 "$SLINT" "$file" "$@" 2>&1)"; rc=$?
  [ "$rc" -eq "$rc_want" ] || { fail "история · $name: код выхода $rc, ожидался $rc_want"; return; }
  for c in $codes; do
    grep -q " $c " <<<"$out" || { fail "история · $name: нет $c в выводе"; return; }
  done
  ok "история · $name"
}

# БФТ эталона (перезапуск акции Bartello) в репозиторий не входит — сверка с источником на фикстуре
expect_story "эталон проходит строго"     0 "$SGOLD" "" --no-source --strict
expect_story "эталон без БФТ рядом"       1 "$SGOLD" "ST013"
expect_story "структура"                  1 "$FIX/broken_story_structure.md" "ST001 ST002 ST003"
expect_story "экраны и ссылки"            1 "$FIX/broken_story_screens.md" "ST006 ST008 ST009 ST010 ST015"
expect_story "смысл: ошибки"              1 "$FIX/broken_story_semantics.md" "ST007 ST008 ST010 ST011 ST012 ST014 ST016"
expect_story "смысл: предупреждения"      1 "$FIX/broken_story_semantics.md" "ST017 ST018 ST020 ST022 ST023"
out="$(python3 "$SLINT" "$FIX/broken_story_semantics.md" 2>&1)"
grep -q "ПТ-3 не отражено" <<<"$out" && fail "история · ПТ от лица команды не должно требовать шага" || ok "история · ПТ команды не персонаж"

sed 's/^| A | Подготовка/| 1 | Подготовка/' "$SGOLD" > "$tmp/stage.md"
expect_story "этапы: ID — латинская буква" 1 "$tmp/stage.md" "ST004" --no-source
sed 's/^| Ш12 | rest | B–E |/| Ш12 | rest | B–F |/' "$SGOLD" > "$tmp/band.md"
expect_story "полоса ожидания не накрывает шаги" 1 "$tmp/band.md" "ST011" --no-source
sed 's/^| Ш4 | guest | D |/| Ш4 | guest | F |/' "$SGOLD" > "$tmp/order.md"
expect_story "шаги идут слева направо" 1 "$tmp/order.md" "ST007" --no-source
sed 's/| E1 | — |$/| E1 | ответ: письмо (PO, 2026-10-17) |/' "$SGOLD" > "$tmp/answered.md"
sed -i 's/^| E1 | Оповещение | уведомление | основной |/| E1 | Оповещение | уведомление | неизвестен |/' "$tmp/answered.md"
expect_story "неизвестный экран без открытого вопроса" 1 "$tmp/answered.md" "ST010" --no-source
sed 's/| Купил билет — и сразу вижу скидку |/| Купил билет — и сразу вижу скидку (ПТ-2) |/' "$SGOLD" > "$tmp/req.md"
expect_story "ID требования в заголовке" 1 "$tmp/req.md" "ST012" --no-source

python3 "$SRENDER" "$SGOLD" --out-dir "$tmp/sout" >/dev/null 2>&1 && ok "история · эталон отрендерен" || fail "история · эталон не отрендерился"
spage="$tmp/sout/golden_story.html"
if grep -Eq 'src="https?://|href="https?://|@import' "$spage"; then fail "история · html: внешние ресурсы"; else ok "история · html: без внешних ресурсов"; fi
python3 - "$spage" <<'PY' && ok "история · html: данные разбираются, 17 карточек, 13 экранов" || fail "история · html: данные страницы не те"
import json, re, sys
page = open(sys.argv[1], encoding="utf-8").read()
data = json.loads(re.search(r'<script type="application/json" id="story-data">(.*?)</script>', page, re.S).group(1))
assert len(data["steps"]) == 17 and len(data["screens"]) == 13, (len(data["steps"]), len(data["screens"]))
assert sum(q["open"] for q in data["questions"]) == 8
assert [s["n"] for s in data["steps"] if s["persona"] == "rest" and s["n"]] == [1, 2, 3, 4, 5, 6]
PY
cmp -s "$spage" "$DIR/examples/golden_story.html" \
  && ok "история · html: совпадает с examples/golden_story.html" \
  || fail "история · html: разошёлся с examples/golden_story.html — пересобери: python3 $SRENDER $SGOLD --out-dir $DIR/examples"
python3 "$SRENDER" "$FIX/broken_story_screens.md" --out-dir "$tmp/sbad" >/dev/null 2>&1; rc=$?
{ [ "$rc" -eq 1 ] && [ ! -e "$tmp/sbad" ]; } && ok "история · битый документ: код 1, файлов нет" || fail "история · битый документ отрендерился или код не 1"

# --- карта инициативы ------------------------------------------------------------------
MLINT="$DIR/scripts/bft-map-lint.py"
MRENDER="$DIR/scripts/bft-map-render.py"
MGOLD="$DIR/examples/golden_map.md"

expect_map() {  # <имя> <ожидаемый rc> <файл> <коды через пробел> [доп. аргументы линтера]
  local name="$1" rc_want="$2" file="$3" codes="$4"; shift 4
  local out rc
  out="$(python3 "$MLINT" "$file" "$@" 2>&1)"; rc=$?
  [ "$rc" -eq "$rc_want" ] || { fail "карта · $name: код выхода $rc, ожидался $rc_want"; return; }
  for c in $codes; do
    grep -q " $c " <<<"$out" || { fail "карта · $name: нет $c в выводе"; return; }
  done
  ok "карта · $name"
}

expect_map "эталон проходит строго"   0 "$MGOLD" "" --no-source --strict
expect_map "эталон без БФТ рядом"     1 "$MGOLD" "MP015"
expect_map "структура"                1 "$FIX/broken_map_structure.md" "MP001 MP002 MP003"
expect_map "ссылки"                   1 "$FIX/broken_map_refs.md" "MP006 MP007 MP008 MP009 MP010 MP011 MP012 MP013"
expect_map "смысл: ошибки"            1 "$FIX/broken_map_semantics.md" "MP014 MP016 MP017 MP018"
expect_map "смысл: предупреждения"    1 "$FIX/broken_map_semantics.md" "MP020 MP021 MP022 MP023 MP024 MP025 MP026 MP027 MP028"
sed 's/^story_doc: .*/story_doc: нет-такой-истории.md/' "$MGOLD" > "$DIR/examples/.tmp_map.md"
expect_map "история не найдена"       1 "$DIR/examples/.tmp_map.md" "MP004" --no-source
rm -f "$DIR/examples/.tmp_map.md"

python3 "$MRENDER" "$MGOLD" --out-dir "$tmp/mout" >/dev/null 2>&1 && ok "карта · эталон отрендерен" || fail "карта · эталон не отрендерился"
mpage="$tmp/mout/golden_map.html"
if grep -Eq 'src="https?://|href="https?://|@import' "$mpage"; then fail "карта · html: внешние ресурсы"; else ok "карта · html: без внешних ресурсов"; fi
python3 - "$mpage" <<'PY' && ok "карта · html: 19 задач, 20 процессов, схемы и критерии у каждого процесса" || fail "карта · html: данные страницы не те"
import json, re, sys
page = open(sys.argv[1], encoding="utf-8").read()
d = json.loads(re.search(r'<script type="application/json" id="map-data">(.*?)</script>', page, re.S).group(1))
assert len(d["tasks"]) == 19 and len(d["processes"]) == 20, (len(d["tasks"]), len(d["processes"]))
assert all(p["steps"] and p["criteria"] for p in d["processes"])
assert all(t["idef"] for t in d["tasks"])
assert {s["col"] for s in d["seen"]} == set(range(7))
PY
cmp -s "$mpage" "$DIR/examples/golden_map.html" \
  && ok "карта · html: совпадает с examples/golden_map.html" \
  || fail "карта · html: разошёлся с examples/golden_map.html — пересобери: python3 $MRENDER $MGOLD --out-dir $DIR/examples"
python3 "$MLINT" "$FIX/map_ok.md" >/dev/null 2>&1 && python3 "$MRENDER" "$FIX/map_ok.md" --out-dir "$tmp/mok" >/dev/null 2>&1 \
  && ok "карта · вторая инициатива: проходит и рисуется" || fail "карта · fixtures/map_ok.md не прошла линтер или не отрисовалась"
python3 "$MRENDER" "$FIX/broken_map_refs.md" --out-dir "$tmp/mbad" >/dev/null 2>&1; rc=$?
{ [ "$rc" -eq 1 ] && [ ! -e "$tmp/mbad" ]; } && ok "карта · битый документ: код 1, файлов нет" || fail "карта · битый документ отрендерился или код не 1"

echo
[ "$fails" -eq 0 ] && echo "bft-blueprint: все проверки пройдены" || echo "bft-blueprint: провалено проверок — $fails"
exit "$fails"
