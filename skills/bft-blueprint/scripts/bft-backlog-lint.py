#!/usr/bin/env python3
"""bft-backlog-lint — проверка Service Blueprint в проекте Backlog.md (гейт карты инициативы).

Карта — второй этап blueprint: на согласованную историю ложатся задачи команд («Что делаем») и
технические карточки («Как это работает»: Employee Actions, Technology, Backstage, Support).
Всё хранится в проекте Backlog.md. Стандарт — `resources/backlog_rules.md`.

  ОШИБКИ (код выхода 1)
  BL001  не проект Backlog.md
  BL002  документ «Карта»: паспорт <!-- bft-map -->, заголовок
  BL003  документ «История»: нет или с ошибками (ST — коды истории)
  BL004  «Команды» и «Вопросы» карты: таблицы, ID
  BL005  файл не читается как задача или документ Backlog.md; повтор ID
  BL006  задача «Что делаем»: этап, вид, команда, без родителя
  BL007  постановка: зачем, разделы ASIS, GAP, TOBE, HowToDemo, критерии приемки
  BL008  карточка «Как это работает»: родитель, слой, этап, команда
  BL009  карточка: разделы UserStory, JobStory, Параметры, Процесс, HowToDemo; параметры, шаги процесса, ссылки
  BL010  вопрос: ID, «Где», тип
  BL011  documentation ссылается на документ, которого нет
  BL014  задача длиннее 80 знаков или карточка длиннее 90 — карта читается за минуту
  BL015  БФТ-источник из `--source` не найден (без `--source` — предупреждение, сверка пропущена)
  BL016  требование из задачи, карточки или экрана не найдено в БФТ
  BL017  ФТ/ИТ/НФТ из БФТ не попало ни в одну задачу и ни в одну карточку
  BL018  технический язык в названии или сути: API, протоколы, БД
  SN0xx  требования к экранам — `bft_screens.py`, `resources/screen_notes.md`

  ПРЕДУПРЕЖДЕНИЯ (код выхода 1 только с --strict)
  BL015  БФТ (`source_doc` паспорта) не лежит рядом с проектом — сверка с БФТ пропущена
  BL020  этап истории без задач — что на нём делают команды?
  BL021  задача без карточки «Как это работает»
  BL022  схема BPMN карточки не совпадает с «Процессом» — пересоберёт `bft-backlog-build.py`
  BL023  у карточки нет управления или механизма
  BL030  UserStory не «Как …, я хочу …, чтобы …» или JobStory не «Когда …, хочу …, чтобы …»
  BL026  БФТ изменился после сборки (`source_rev` не совпадает)
  BL027  число не найдено ни в БФТ, ни в ответах на вопросы
  BL028  карточка без связей: ни один вход не пришёл от карточки, ни один выход не ушёл к карточке

Использование:
    python3 bft-backlog-lint.py <проект> [--source БФТ.md | --no-source] [--strict]
Формат вывода: <путь>:<строка>: <УРОВЕНЬ> <КОД> <сообщение>
Коды выхода: 0 — ошибок нет; 1 — ошибки (или предупреждения с --strict); 2 — проект не прочитан.
"""
from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import bft_blueprint as bb  # noqa: E402
import bft_backlog as bl  # noqa: E402

_spec = importlib.util.spec_from_file_location("bp_lint", HERE / "bft-blueprint-lint.py")
_bp_lint = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_bp_lint)
API_PATTERNS = _bp_lint.API_PATTERNS
NUM_RE = _bp_lint.NUM_RE


def check(pr: bl.Project, source: Path | None, no_source: bool, explicit: bool = False) -> None:
    # --- полнота и связность -----------------------------------------------------------------
    if pr.story:
        for st in pr.story.stages:
            if not any(t.stage == st.id for t in pr.tasks):
                pr.warn(pr.story_doc.rel, st.line + pr.story_doc.off, "BL020", f"этап {st.id} «{st.name}» без задач — что на нём делают команды?")
    with_card = {c.parent for c in pr.cards}
    linked = {x for a, b, _ in pr.links() for x in (a, b)}
    for t in pr.tasks:
        if t.id not in with_card:
            pr.warn(t.rel, 1, "BL021", f"{t.id}: задача не показана в «Как это работает» — нет подзадачи с меткой layer:…")
        if len(t.title) > bl.MAX_TASK:
            pr.err(t.rel, 2, "BL014", f"{t.id}: задача {len(t.title)} знаков (больше {bl.MAX_TASK}) — один результат одной фразой")
        tech(pr, t, t.title + " " + t.why)
    for c in pr.cards:
        if c.params.get("out") and (not c.params.get("ctl") or not c.params.get("mech")):
            pr.warn(c.rel, c.off, "BL023", f"{c.id}: нет {'управления' if not c.params.get('ctl') else 'механизма'} — правила и исполнитель функции")
        if c.id not in linked:
            pr.warn(c.rel, c.off, "BL028", f"{c.id}: нет связей — сошлись на карточку во входе ({pr.prefix}-8.1) или выходе")
        if len(c.title) > bl.MAX_CARD:
            pr.err(c.rel, 2, "BL014", f"{c.id}: карточка {len(c.title)} знаков (больше {bl.MAX_CARD})")
        tech(pr, c, c.title + " " + c.lead)
    for c in bl.sync_schema(pr, write=False):
        pr.warn(c.rel, c.off, "BL022", f"{c.id}: схема BPMN не совпадает с «Процессом» — `./blueprint.py build` пересоберёт её")

    # --- сверка с БФТ ------------------------------------------------------------------------
    if no_source:
        return
    if source is None or not source.is_file():
        # явный --source обязан найтись; без него — проект без БФТ рядом (распакованный архив): сверка пропускается
        (pr.err if explicit else pr.warn)(pr.map_doc.rel if pr.map_doc else "", 1, "BL015",
                                          f"БФТ-источник не найден: {source or pr.meta.get('source_doc', '—')} — сверка с БФТ пропущена")
        return
    reqs, src_text = bb.load_requirements(source)
    if pr.meta.get("source_rev") and pr.meta["source_rev"] != bb.source_rev(source):
        pr.warn(pr.map_doc.rel, 1, "BL026", "БФТ изменился после сборки (source_rev не совпадает) — пересверь карту")
    cited: set[str] = set()
    texts = []
    for t in pr.tasks + pr.cards:
        body = "\n".join([bl.MERMAID.sub("", t.desc)] + [x for _, x in t.ac])  # схема — копия параметров, не источник
        texts.append((t, body))
        for rid in sorted(set(bb.REQ_RE.findall(body))):
            if rid not in reqs:
                pr.err(t.rel, 1, "BL016", f"{t.id}: {rid} нет в БФТ {source.name}")
            else:
                cited.add(rid)
    for d in pr.screens.values():
        for x in d.notes:
            for rid in bb.REQ_RE.findall(x.md):
                if rid not in reqs:
                    pr.err(d.rel, x.line, "BL016", f"«{x.title}»: {rid} нет в БФТ {source.name}")
    for rid in reqs:
        if rid.split("-")[0] in ("ФТ", "ИТ", "НФТ") and rid not in cited:
            pr.err(pr.map_doc.rel, 1, "BL017", f"{rid} не попало ни в одну задачу и ни в одну карточку — где эта работа на карте?")
    answers = " ".join(q.answer for q in pr.questions if not q.open)
    for t, body in texts:
        clean = pr.id_re.sub("", bb.REQ_RE.sub("", body))
        for m in NUM_RE.finditer(clean):
            num = m.group(0).strip(" .,:")
            if num and num not in src_text and num not in answers:
                pr.warn(t.rel, 1, "BL027", f"{t.id}: число «{num}» не найдено ни в БФТ, ни в ответах")


def tech(pr: bl.Project, t: bl.BTask, text: str) -> None:
    for pat, what in API_PATTERNS:
        m = pat.search(text)
        if m:
            pr.err(t.rel, 2, "BL018", f"{t.id}: {what} «{m.group(0)}» — устройство API и БД живёт у СА, не на карте")
            return


def resolve_source(pr: bl.Project, explicit: str | None) -> Path | None:
    if explicit:
        return Path(explicit)
    doc = pr.meta.get("source_doc")
    if not doc:
        return None
    for base in (pr.root, pr.root.parent):
        if (base / doc).is_file():
            return base / doc
    return pr.root.parent / doc


def run(root: Path, source: str | None, no_source: bool) -> bl.Project:
    pr = bl.parse(root)
    if not pr.errors:
        check(pr, resolve_source(pr, source), no_source, explicit=bool(source))
    return pr


def report(pr: bl.Project, strict: bool, name: str = "backlog-lint") -> int:
    for i in sorted(pr.issues, key=lambda i: (i.level != "ERROR", i.path, i.line)):
        print(f"{pr.root / i.path if i.path else pr.root}:{i.line}: {i.level} {i.code} {i.msg}")
    errors = len(pr.errors)
    warns = len(pr.issues) - errors
    blockers = [q for q in pr.questions if q.open and q.kind == "блокер"]
    for q in blockers:
        print(f"  блокер {q.id} → {q.to}: {q.text}")
    print(f"{name}: {len(pr.tasks)} задач, {len(pr.cards)} карточек «Как это работает», {len(pr.screens)} экранов с требованиями, "
          f"задач вне карты {pr.other}, открытых вопросов {sum(q.open for q in pr.questions)} (блокеров {len(blockers)}) — "
          f"ошибок {errors}, предупреждений {warns}")
    return 1 if errors or (strict and warns) else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("project", type=Path, help="папка проекта Backlog.md (<epic>-blueprint)")
    ap.add_argument("--source", help="путь к БФТ (по умолчанию — `source_doc` паспорта рядом с проектом)")
    ap.add_argument("--no-source", action="store_true", help="не сверять с БФТ (только форма карты)")
    ap.add_argument("--strict", action="store_true", help="предупреждения тоже дают код 1")
    args = ap.parse_args()
    if not args.project.is_dir():
        print(f"{args.project}: не папка проекта", file=sys.stderr)
        return 2
    try:
        pr = run(args.project, args.source, args.no_source)
    except OSError as e:
        print(f"{args.project}: не прочитан: {e}", file=sys.stderr)
        return 2
    return report(pr, args.strict)


if __name__ == "__main__":
    sys.exit(main())
