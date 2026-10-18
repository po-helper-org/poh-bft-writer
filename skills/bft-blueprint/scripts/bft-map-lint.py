#!/usr/bin/env python3
"""bft-map-lint — машинная проверка `<epic_slug>-map.md` (гейт карты инициативы).

Карта — второй этап blueprint: на согласованную историю ложатся задачи команд и то, как это
работает (Frontstage, Backstage, Support). Стандарт — `resources/map_rules.md`.

  ОШИБКИ (код выхода 1)
  MP001  frontmatter: ключи, `stage: map`, `story_doc`
  MP002  H1 `# [Карта]`, разделы и их порядок
  MP003  таблица раздела: заголовок колонок, число колонок; в «IDEF0» и «Схемах» — только блоки
  MP004  история не найдена или с ошибками
  MP005  команда: ID-слаг, название
  MP006  задача: ID, этап истории, команда, статус, текст
  MP007  IDEF0: блок ```idef0 1.2``` у существующей задачи, один на задачу
  MP008  процесс: ID, задача, этап, слой, текст
  MP009  участник: ID, вид
  MP010  схема: блок ```seq П3``` у существующего процесса, один на процесс
  MP011  критерий: процесс
  MP012  цепочка: ссылки на процессы
  MP013  вопрос: ID, «Где», тип
  MP014  задача длиннее 80 знаков или процесс длиннее 90 — карта читается за минуту
  MP015  БФТ-источник не найден (`source_doc`); с `--no-source` пропускается
  MP016  требование из задачи или критерия не найдено в БФТ
  MP017  ФТ/ИТ/НФТ из БФТ не попало ни в одну задачу и ни в один критерий
  MP018  технический язык в задаче, процессе или описании схемы: API, протоколы, БД
  DG0xx  синтаксис и смысл блоков схем — `diagram_dsl.py`, `resources/diagram_dsl.md`

  ПРЕДУПРЕЖДЕНИЯ (код выхода 1 только с --strict)
  MP020  этап истории без задач — что на нём делают команды?
  MP021  задача без процесса в «Как это работает»
  MP022  задача без IDEF0
  MP023  процесс без схемы или без критериев
  DG020+ предупреждения блоков схем: размер, описание, ответ без вызова, IDEF0-стрелки
  MP025  участник не встречается ни в одной схеме
  MP026  БФТ изменился после сборки (`source_rev` не совпадает)
  MP027  число не найдено ни в БФТ, ни в ответах на вопросы
  MP028  процесс без связей в «Цепочке» — не видно, что до и что после

Использование:
    python3 bft-map-lint.py <epic>-map.md [--source БФТ.md | --no-source] [--strict]
Формат вывода: <путь>:<строка>: <УРОВЕНЬ> <КОД> <сообщение>
Коды выхода: 0 — ошибок нет; 1 — ошибки (или предупреждения с --strict); 2 — файл не прочитан.
"""
from __future__ import annotations

import argparse
import importlib.util
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import bft_blueprint as bb  # noqa: E402
import bft_map as bm  # noqa: E402

_spec = importlib.util.spec_from_file_location("bp_lint", HERE / "bft-blueprint-lint.py")
_bp_lint = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_bp_lint)
API_PATTERNS = _bp_lint.API_PATTERNS
NUM_RE = _bp_lint.NUM_RE


def check(mp: bm.Map, source: Path | None, no_source: bool) -> None:
    # --- полнота и связность -------------------------------------------------------------
    if mp.story:
        for st in mp.story.stages:
            if not any(t.stage == st.id for t in mp.tasks):
                mp.warn(st.line, "MP020", f"этап {st.id} «{st.name}» без задач — что на нём делают команды?")
    with_proc = {p.task for p in mp.processes}
    with_idef = {i.task for i in mp.idef}
    for t in mp.tasks:
        if len(t.text) > bm.MAX_TASK:
            mp.err(t.line, "MP014", f"{t.id}: задача {len(t.text)} знаков (больше {bm.MAX_TASK}) — один результат одной фразой")
        if t.id not in with_proc:
            mp.warn(t.line, "MP021", f"{t.id}: задача не показана в «Как это работает»")
        if t.id not in with_idef:
            mp.warn(t.line, "MP022", f"{t.id}: нет IDEF0")
        tech(mp, t.line, t.id, t.text)
    linked = {x for ln in mp.links for x in (ln.src, ln.dst)}
    for p in mp.processes:
        if len(p.text) > bm.MAX_PROC:
            mp.err(p.line, "MP014", f"{p.id}: процесс {len(p.text)} знаков (больше {bm.MAX_PROC})")
        steps = [s for s in mp.steps if s.process == p.id]
        if not steps or not any(c.process == p.id for c in mp.criteria):
            mp.warn(p.line, "MP023", f"{p.id}: нет {'схемы' if not steps else 'критериев'} — техлиду не видно, как это устроено")
        if p.id not in linked:
            mp.warn(p.line, "MP028", f"{p.id}: нет связей в «Цепочке»")
        tech(mp, p.line, p.id, p.text)
        if p.desc:
            tech(mp, p.line, p.id, p.desc)
    used = {x for s in mp.steps for x in (s.src, s.dst)}
    for pt in mp.parts:
        if pt.id not in used:
            mp.warn(pt.line, "MP025", f"участник {pt.id} не встречается ни в одной схеме")

    # --- сверка с БФТ --------------------------------------------------------------------
    if no_source:
        return
    if source is None or not source.is_file():
        mp.err(1, "MP015", f"БФТ-источник не найден: {source or mp.meta.get('source_doc', '—')}")
        return
    reqs, src_text = bb.load_requirements(source)
    if mp.meta.get("source_rev") and mp.meta["source_rev"] != bb.source_rev(source):
        mp.warn(1, "MP026", "БФТ изменился после сборки (source_rev не совпадает) — пересверь карту")
    cited: set[str] = set()
    for line, owner, ids in [(t.line, t.id, t.reqs) for t in mp.tasks] + \
                            [(c.line, c.process, bb.REQ_RE.findall(c.source)) for c in mp.criteria] + \
                            [(p.line, p.id, bb.REQ_RE.findall(p.source)) for p in mp.processes]:
        for rid in ids:
            if rid not in reqs:
                mp.err(line, "MP016", f"{owner}: {rid} нет в БФТ {source.name}")
            else:
                cited.add(rid)
    for rid in reqs:
        if rid.split("-")[0] in ("ФТ", "ИТ", "НФТ") and rid not in cited:
            mp.err(1, "MP017", f"{rid} не попало ни в одну задачу и ни в один критерий — где эта работа на карте?")
    answers = " ".join(q.answer for q in mp.questions if not q.open)
    texts = [(t.line, t.id, t.text) for t in mp.tasks] + [(p.line, p.id, p.text) for p in mp.processes] + \
            [(c.line, c.process, c.text) for c in mp.criteria] + [(s.line, s.process, s.text) for s in mp.steps] + \
            [(p.line, p.id, p.desc) for p in mp.processes if p.desc]
    for line, owner, txt in texts:
        clean = bb.REQ_RE.sub("", txt)
        for m in NUM_RE.finditer(clean):
            num = m.group(0).strip(" .,:")
            if num and num not in src_text and num not in answers:
                mp.warn(line, "MP027", f"{owner}: число «{num}» не найдено ни в БФТ, ни в ответах")


def tech(mp: bm.Map, line: int, owner: str, text: str) -> None:
    for pat, what in API_PATTERNS:
        m = pat.search(text)
        if m:
            mp.err(line, "MP018", f"{owner}: {what} «{m.group(0)}» — устройство API и БД живёт у СА, не на карте")
            return


def resolve_source(mp: bm.Map, explicit: str | None) -> Path | None:
    if explicit:
        return Path(explicit)
    doc = mp.meta.get("source_doc")
    return (mp.path.parent / doc) if doc else None


def run(path: Path, source: str | None, no_source: bool) -> bm.Map:
    mp = bm.parse(path)
    if not mp.errors:
        check(mp, resolve_source(mp, source), no_source)
    return mp


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("file", type=Path)
    ap.add_argument("--source", help="путь к БФТ (по умолчанию — `source_doc` из frontmatter рядом с файлом)")
    ap.add_argument("--no-source", action="store_true", help="не сверять с БФТ (только форма карты)")
    ap.add_argument("--strict", action="store_true", help="предупреждения тоже дают код 1")
    args = ap.parse_args()
    try:
        mp = run(args.file, args.source, args.no_source)
    except OSError as e:
        print(f"{args.file}: не прочитан: {e}", file=sys.stderr)
        return 2
    for i in sorted(mp.issues, key=lambda i: (i.level != "ERROR", i.line)):
        print(f"{args.file}:{i.line}: {i.level} {i.code} {i.msg}")
    errors = len(mp.errors)
    warns = len(mp.issues) - errors
    blockers = [q for q in mp.questions if q.open and q.kind == "блокер"]
    for q in blockers:
        print(f"  блокер {q.id} → {q.to}: {q.text}")
    print(f"map-lint: {len(mp.tasks)} задач, {len(mp.processes)} процессов, {len(mp.steps)} шагов схем, "
          f"открытых вопросов {sum(q.open for q in mp.questions)} (блокеров {len(blockers)}) — ошибок {errors}, предупреждений {warns}")
    return 1 if errors or (args.strict and warns) else 0


if __name__ == "__main__":
    sys.exit(main())
