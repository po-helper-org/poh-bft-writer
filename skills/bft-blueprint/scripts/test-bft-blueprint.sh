#!/bin/bash
# Самотест bft-blueprint: линтер ловит каждый код на фикстурах, эталон проходит строго,
# рендерер не пишет файлов по сломанному документу, стрелки не пересекают чужие карточки.
# Вторая часть — история через экраны (bft-story-*), третья — карта инициативы в проекте Backlog.md
# (bft-backlog-*): коды BL и SN на сломанных копиях, страница эталона байт в байт, детерминированный
# автономный проект и zip (встроенный CLI, инструкции агенту), BPMN из «Процесса», новый проект из истории.
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

# БФТ эталона (перезапуск акции DineClub) в репозиторий не входит — сверка с источником на фикстуре
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

# --- карта инициативы: проект Backlog.md -------------------------------------------------
BLINT="$DIR/scripts/bft-backlog-lint.py"
BBUILD="$DIR/scripts/bft-backlog-build.py"
BGOLD="$DIR/examples/dineclub-restart-blueprint"
BOK="$FIX/backlog_ok"

expect_bl() {  # <имя> <ожидаемый rc> <проект> <коды через пробел> [доп. аргументы линтера]
  local name="$1" rc_want="$2" proj="$3" codes="$4"; shift 4
  local out rc
  out="$(python3 "$BLINT" "$proj" "$@" 2>&1)"; rc=$?
  [ "$rc" -eq "$rc_want" ] || { fail "карта · $name: код выхода $rc, ожидался $rc_want"; return; }
  for c in $codes; do
    grep -q " $c " <<<"$out" || { fail "карта · $name: нет $c в выводе"; return; }
  done
  ok "карта · $name"
}

expect_bl "эталон проходит строго"        0 "$BGOLD" "" --no-source --strict
expect_bl "эталон без БФТ рядом"          0 "$BGOLD" "BL015"
expect_bl "явный --source не найден"      1 "$BGOLD" "BL015" --source "$tmp/нет.md"
expect_bl "вторая инициатива сверена с БФТ" 0 "$BOK" ""

# сломанные копии второй инициативы: каждая правка — свой код
python3 - "$BOK" "$tmp/bad" "$FIX/screens_bad" <<'PY'
import re, shutil, sys
from pathlib import Path
src, out, sbad = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
def copy(name):
    d = out / name; shutil.copytree(src, d); return d
def edit(d, glob, a, b, count=1):
    f = next(d.glob(glob)); t = f.read_text(encoding="utf-8")
    assert a in t, (glob, a); f.write_text(t.replace(a, b, count), encoding="utf-8")
T1, T2 = "backlog/tasks/bp-1 - *.md", "backlog/tasks/bp-2 - *.md"
C1, C21, C22 = "backlog/tasks/bp-1.1 - *.md", "backlog/tasks/bp-2.1 - *.md", "backlog/tasks/bp-2.2 - *.md"
MAP, STORY = "backlog/docs/doc-1 - *.md", "backlog/docs/doc-2 - *.md"

d = copy("noproject"); (d / "backlog/config.yml").unlink()
d = copy("structure")
edit(d, MAP, "<!-- bft-map\nepic_slug: demo-story\n", "<!-- bft-map\n")
edit(d, MAP, "| ID | Команда |", "| ID | Команда | Лишняя |")
edit(d, STORY, "## Этапы", "## Этапы и ещё")
(d / "backlog/tasks/bp-9 - Мусор.md").write_text("просто текст\n", encoding="utf-8")
d = copy("refs")
edit(d, T1, "  - 'stage:A'\n  - создать", "  - 'stage:Z'")
edit(d, T2, "  - '@rest'", "  - '@nobody'")
edit(d, T2, "### ASIS\nСкидка по брони.\n\n", "")
edit(d, T2, "1. Официант сканирует билет\n2.", "Официант сканирует билет.")
edit(d, T2, "- [ ] #1 Скидка 10% по предъявлению билета\n- [ ] #2 Отказ — с причиной\n", "")
edit(d, C1, "parent_task_id: BP-1", "parent_task_id: BP-77")
edit(d, C21, "layer:employee", "layer:frontstage")
edit(d, C22, "- **Выход:** Ответ проверки (BP-2.1)", "- **Результат:** Ответ проверки (BP-9.9)")
edit(d, MAP, "| BP-2.1 | вопрос |", "| BP-99 | разговор |")
edit(d, C21, "  - нет → Официант: Объясняет отказ [УТОЧНИТЬ у PO]\n", "")
edit(d, C22, "- Сканер: Передаёт штрихкод", "- Сканер передаёт штрихкод")
edit(d, C1, "### UserStory\nКак гость, я хочу сразу после покупки увидеть скидку, чтобы спланировать вечер.\n\n", "")
edit(d, T1, "dependencies: []", "dependencies: []\ndocumentation:\n  - doc-42")
d = copy("semantics")
edit(d, T1, "title: Блок акции на странице после покупки", "title: Блок акции на странице после покупки с очень длинным названием, которое не читается за секунду")
edit(d, T2, "Скидка выдаётся по билету", "Скидка выдаётся по билету через REST API")
edit(d, T1, "Требования БФТ: ПТ-2, ИТ-1", "Требования БФТ: ПТ-2, ФТ-77")
edit(d, C1, "Один офер (ИТ-1)", "Один офер")
d = copy("warnings")
edit(d, T2, "  - 'stage:B'", "  - 'stage:A'")
for g in (C21, C22):
    next(d.glob(g)).unlink()
edit(d, C1, "- **Управление:** Один офер (ИТ-1)\n", "")
edit(d, C1, "Как гость, я хочу сразу после покупки увидеть скидку", "Гость хочет сразу после покупки увидеть скидку")
edit(d, C1, "Гость выбрал ресторан (BP-2.1)", "Скидка через 99 минут")
edit(d, C1, 'N2["Показывает блок «скидка 10%»"]', 'N2["Старое"]')
edit(d, MAP, "| В1 | PO | Что видит официант при отказе? | BP-2.1 |", "| В1 | PO | Что видит официант при отказе? | BP-2 |")
d = copy("screens")
for f in sorted(sbad.glob("*.md")):
    t = f.read_text(encoding="utf-8")
    title = re.search(r"^# (.+)$", t, re.M)
    hdr = f"{f.stem} · {title.group(1) if title else 'без заголовка'}"
    (d / "backlog/docs/screens").mkdir(parents=True, exist_ok=True)
    (d / f"backlog/docs/screens/doc-{30 + len(list((d / 'backlog/docs/screens').glob('*')))} - {f.stem}.md").write_text(
        f"---\nid: doc-{30 + len(list((d / 'backlog/docs/screens').glob('*')))}\ntitle: {hdr}\ntype: specification\ncreated_date: '2026-10-19 10:00'\n---\n{t}", encoding="utf-8")
(d / "backlog/docs/screens/doc-40 - Без-ID.md").write_text("---\nid: doc-40\ntitle: Просто экран\ntype: specification\n---\n# Экран\n", encoding="utf-8")
PY
expect_bl "не проект Backlog.md"          1 "$tmp/bad/noproject" "BL001"
expect_bl "структура"                     1 "$tmp/bad/structure" "BL002 BL003 BL004 BL005" --no-source
expect_bl "задачи и карточки"             1 "$tmp/bad/refs" "BL006 BL007 BL008 BL009 BL010 BL011" --no-source
expect_bl "смысл: ошибки"                 1 "$tmp/bad/semantics" "BL014 BL016 BL017 BL018" --source "$FIX/story_source.md"
expect_bl "смысл: предупреждения"         1 "$tmp/bad/warnings" "BL020 BL021 BL022 BL023 BL026 BL027 BL028 BL030" --strict --source "$FIX/story_source.md"
expect_bl "экраны · битые заметки"        1 "$tmp/bad/screens" "SN001 SN002 SN003 SN004 SN005 SN006 SN020 SN021 SN022 SN023" --no-source

# сборка: эталон совпадает со страницей в examples, архив — тот же байт в байт и автономный
python3 "$BBUILD" "$BGOLD" --no-source --check >/dev/null 2>&1 \
  && ok "карта · эталон: схемы BPMN, скрипты и инструкции проекта актуальны" || fail "карта · эталон устарел (BL022/BL029) — python3 $BBUILD $BGOLD --no-source --out-dir $DIR/examples --no-zip"
cp -r "$BGOLD" "$tmp/gold" && python3 "$BBUILD" "$tmp/gold" --out-dir "$tmp/bout" >/dev/null 2>&1 \
  && cmp -s "$tmp/bout/dineclub-restart-map.html" "$DIR/examples/dineclub-restart-map.html" \
  && ok "карта · html: совпадает с examples/dineclub-restart-map.html" \
  || fail "карта · html разошёлся с эталоном — пересобери: python3 $BBUILD $BGOLD --out-dir $DIR/examples --no-zip"
python3 - "$tmp/bout" <<'PY' && ok "карта · страница: 19 задач, 20 карточек в четырёх слоях, стрелки, заметки экранов" || fail "карта · данные страницы не те"
import json, re, sys
from pathlib import Path
d = json.loads(re.search(r'id="map-data">(.*?)</script>', (Path(sys.argv[1]) / "dineclub-restart-map.html").read_text(encoding="utf-8"), re.S).group(1))
assert len(d["tasks"]) == 19 and len(d["cards"]) == 20, (len(d["tasks"]), len(d["cards"]))
assert {c["layer"] for c in d["cards"]} == {"employee", "technology", "backstage", "support"}
assert all(c["params"].get("out") and c["demo"] and c["us"] and c["js"] and len(c["proc"]) >= 2 for c in d["cards"])
assert all(t["brief"].get("ASIS") and t["ac"] for t in d["tasks"])
assert len(d["links"]) >= 20 and len(d["notes"]) == 12
PY
cp "$tmp/bout/dineclub-restart-blueprint.zip" "$tmp/first.zip"
python3 "$BBUILD" "$tmp/gold" --out-dir "$tmp/bout" >/dev/null 2>&1 && cmp -s "$tmp/bout/dineclub-restart-blueprint.zip" "$tmp/first.zip" \
  && ok "карта · zip: та же карта — тот же архив байт в байт" || fail "карта · zip: архив не детерминирован"
python3 - "$tmp/first.zip" "$tmp/unz" <<'PY' || fail "карта · zip: распаковка не удалась"
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1]); z.extractall(sys.argv[2])
assert all(z.getinfo(f"dineclub-restart-blueprint/{n}").external_attr >> 16 == 0o755 for n in ("backlog.py", "blueprint.py"))
PY
# распакованный проект в чистом окружении: только python3, без навыка и без npm
( cd "$tmp/unz/dineclub-restart-blueprint" && E="env -i PATH=/usr/bin:/bin HOME=$tmp" \
  && $E python3 blueprint.py build >/dev/null 2>&1 && cmp -s blueprint.html dineclub-restart-map.html \
  && $E python3 backlog.py task list -l stage:F --plain | grep -q "BP-16 - " \
  && $E python3 backlog.py task create "Учесть часовой пояс площадки" -p BP-16 -a "" -l "stage:F,layer:backstage" --no-dod-defaults \
       -d $'TeamA учитывает часовой пояс.\n\n### UserStory\nКак официант, я хочу верную проверку в полночь, чтобы не спорить с гостем.\n\n### JobStory\n- Когда гость пришёл в последний день, хочу верный ответ, чтобы дать скидку.\n\n### Параметры\n- **Вход:** Штрихкод (BP-16.1)\n- **Управление:** Окно 7 дней (ФТ-1)\n- **Выход:** Ответ (BP-15.1)\n- **Механизм:** TeamA\n\n### Процесс\n- TeamA: Берёт часовой пояс площадки\n- TeamA: Считает окно\n\n### HowToDemo\n1. Сканирую в 23:59\n2. Проверка проходит' >/dev/null \
  && $E python3 backlog.py task edit BP-16 --check-ac 1 --add-ref https://jira.example.com/browse/DEMO-16 >/dev/null \
  && $E python3 blueprint.py build >/dev/null 2>&1 && $E python3 blueprint.py check >/dev/null 2>&1 \
  && grep -q "Берёт часовой пояс площадки" "$(ls backlog/tasks/bp-16.2*)" && grep -q 'N1\["Берёт часовой пояс площадки"\]' "$(ls backlog/tasks/bp-16.2*)" \
  && grep -q "./backlog.py" CLAUDE.md AGENTS.md GEMINI.md && grep -q "Bash(./backlog.py:\*)" .claude/settings.json \
  && ! grep -q "skills_path>/bft-blueprint/scripts/bft-backlog-lint" CLAUDE.md ) \
  && ok "карта · zip: автономный проект — ./backlog.py и ./blueprint.py без установки, инструкции агенту" || fail "карта · zip: распакованный проект не автономен"

# BPMN собирается из «Процесса»: правка процесса → сборка переписывает блок mermaid
python3 - "$tmp/gold" <<'PY'
import sys
from pathlib import Path
f = next(Path(sys.argv[1]).glob("backlog/tasks/bp-16.1 - *.md")); t = f.read_text(encoding="utf-8")
f.write_text(t.replace("- Приложение-сканер: Показывает ответ официанту", "- Приложение-сканер: Показывает ответ официанту\n- TeamA: Пишет журнал проверок"), encoding="utf-8")
PY
python3 "$BBUILD" "$tmp/gold" --check >/dev/null 2>&1; rc=$?
python3 "$BBUILD" "$tmp/gold" --out-dir "$tmp/bout2" --no-zip >/dev/null 2>&1 \
  && [ "$rc" -eq 1 ] && grep -q '\["Пишет журнал проверок"\]' "$tmp/gold/backlog/tasks/bp-16.1 - "*.md \
  && python3 "$BBUILD" "$tmp/gold" --check >/dev/null 2>&1 \
  && ok "карта · BPMN: --check ловит устаревшую схему, сборка переписывает mermaid" || fail "карта · BPMN не пересобрался из процесса"
python3 "$BBUILD" "$tmp/bad/refs" --out-dir "$tmp/bbad" --no-source >/dev/null 2>&1; rc=$?
{ [ "$rc" -eq 1 ] && [ ! -e "$tmp/bbad" ]; } && ok "карта · сломанный проект — код 1, файлов нет" || fail "карта · сборка по сломанному проекту (rc=$rc)"

# новый проект из согласованной истории: сразу автономный
python3 "$DIR/scripts/bft-backlog-init.py" "$FIX/story_ok.md" --dir "$tmp/init" >/dev/null 2>&1 \
  && python3 "$BLINT" "$tmp/init" --no-source >/dev/null 2>&1 \
  && grep -q "BFT-BLUEPRINT START" "$tmp/init/CLAUDE.md" "$tmp/init/AGENTS.md" "$tmp/init/GEMINI.md" \
  && ( cd "$tmp/init" && python3 backlog.py doc list | grep -q "doc-2 - История" ) \
  && ok "карта · init: проект из истории, «Карта» и «История», инструкции агенту" || fail "карта · bft-backlog-init.py не собрал проект"
python3 "$DIR/scripts/bft-backlog-init.py" "$DIR/scripts/fixtures/broken_story_semantics.md" --dir "$tmp/init2" >/dev/null 2>&1; rc=$?
{ [ "$rc" -eq 1 ] && [ ! -e "$tmp/init2" ]; } && ok "карта · init: история с ошибками — проект не создаётся" || fail "карта · init по сломанной истории (rc=$rc)"

# встроенный CLI и настоящий Backlog.md читают файлы друг друга — если npm-пакет установлен
if command -v backlog >/dev/null 2>&1; then
  ( cd "$tmp/unz/dineclub-restart-blueprint" && [ "$(backlog task list --plain 2>/dev/null | grep -c 'BP-')" -eq 40 ] \
    && backlog task view BP-16.2 --plain 2>/dev/null | grep -q "Parent: BP-16" \
    && backlog task view BP-16 --plain 2>/dev/null | grep -q "jira.example.com" \
    && backlog task edit BP-16.2 --ac "Граница 23:59 по площадке" --check-ac 1 >/dev/null 2>&1 \
    && python3 backlog.py task view BP-16.2 --plain | grep -q "\[x\] #1 Граница 23:59" ) \
    && ok "карта · встроенный CLI и npm-пакет backlog.md читают и правят одни файлы" || fail "карта · встроенный CLI разошёлся с Backlog.md"
fi

echo
[ "$fails" -eq 0 ] && echo "bft-blueprint: все проверки пройдены" || echo "bft-blueprint: провалено проверок — $fails"
exit "$fails"
