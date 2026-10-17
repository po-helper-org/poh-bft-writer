#!/usr/bin/env python3
"""bft-story-lint — машинная проверка `<epic_slug>-story.md` (гейт верхней линии blueprint).

История через экраны — первый этап blueprint: простой нетехнический рассказ, что инициатива
меняет для каждого, кто будет ей пользоваться. Стандарт — `resources/story_line.md`.

  ОШИБКИ (код выхода 1)
  ST001  frontmatter: ключи, `stage: story`, `source_stage`
  ST002  H1 `# [История]`, разделы и их порядок
  ST003  таблица раздела: заголовок колонок, число колонок
  ST004  этапы: ID A…H по порядку, от 2 до 8
  ST005  персонажи: ID-слаг, имя, дорожка; от 1 до 3
  ST006  шаг: ID, персонаж, этап или диапазон
  ST007  у персонажа ровно одно «было» и одно «стало», между ними шаги; «было» с «Раньше»;
         шаги персонажа идут слева направо
  ST008  карточка: заголовок до 50 знаков, пояснение до 120, экранов на шаге до двух,
         экран помещается в кадр
  ST009  экран: ID, устройство, вид, состав; шаг ссылается на объявленный экран
  ST010  контур пуст; экран `неизвестен` без открытого вопроса о нём
  ST011  шаг с экранами стоит в одном этапе; диапазон — только у полосы ожидания без экранов
  ST012  технический язык в истории: ID требований, API, протоколы, БД, слова разработки
  ST013  БФТ-источник не найден (`source_doc`); с `--no-source` пропускается
  ST014  требование из «Источника» не найдено в БФТ
  ST015  вопрос: ID, «Кому», «Вопрос», «Где» ссылается на шаг или экран
  ST016  нет источника у шага или экрана: история без опоры — выдумка

  ПРЕДУПРЕЖДЕНИЯ (код выхода 1 только с --strict)
  ST017  число в истории не найдено ни в БФТ, ни в ответах на вопросы
  ST018  БФТ изменился после сборки (`source_rev` не совпадает)
  ST020  ПТ из БФТ не отражено ни в одном шаге
  ST021  у персонажа больше 9 шагов: история перестаёт читаться
  ST022  экран не стоит ни на одном шаге
  ST023  контур вне словаря — иконка будет общей

Открытые вопросы — не дефект: на них держатся красные точки. Линтер печатает их сводкой.

Использование:
    python3 bft-story-lint.py <epic>-story.md [--source БФТ.md | --no-source] [--strict]
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
import bft_story as bs  # noqa: E402

_spec = importlib.util.spec_from_file_location("bp_lint", HERE / "bft-blueprint-lint.py")
_bp_lint = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_bp_lint)
API_PATTERNS = _bp_lint.API_PATTERNS
NUM_RE = _bp_lint.NUM_RE

# Слова разработки: история рассказывается языком того, кто пользуется, а не того, кто строит.
TECH_RE = re.compile(
    r"(?i)(?<![А-Яа-яЁё])(?:бэкенд\w*|бэк(?![А-Яа-яЁё])|фронтенд\w*|микросервис\w*|сервер\w*|база данных|БД(?![А-Яа-яЁё])|"
    r"API|SDK|интерфейс программ\w*|деплой\w*|клан\w*|бэклог\w*)"
)
# Контуры, для которых у страницы есть иконка (story_page.js, `contourIcon`).
CONTOUR_RE = re.compile(r"(?i)витрин|сайт|email|e-mail|письм|sms|смс|push|пуш|оповещ|уведомл|билет|сканер|приложен|офлайн|звонок|чат")


def team_story(src_text: str, rid: str) -> bool:
    """ПТ от лица команды («Когда я (команда …)») — не персонаж истории, его место ниже линии видимости."""
    row = next((ln for ln in src_text.splitlines() if re.match(rf"\|\s*{re.escape(rid)}\s*\|", ln)), "")
    return bool(re.search(r"Когда\s+(?:я|мы)\s*\(\s*команд", row))


def story_texts(st: bs.Story):
    """(строка, где, текст) — всё, что человек читает на верхней линии."""
    for s in st.steps:
        yield s.line, s.id, s.title
        yield s.line, s.id, s.text
        if s.was:
            yield s.line, s.id, s.was
    for p in st.personas:
        yield p.line, p.id, p.before
        yield p.line, p.id, p.after
    for sc in st.screens:
        for el in sc.elements:
            for part in el[1:]:
                if isinstance(part, str):
                    yield sc.line, sc.id, part
                elif isinstance(part, list):
                    yield sc.line, sc.id, " ".join(part)


def check(st: bs.Story, source: Path | None, no_source: bool) -> None:
    # --- персонажи и порядок чтения ------------------------------------------------------
    for p in st.personas:
        steps = st.steps_of(p.id)
        intro = [s for s in steps if s.kind == "intro"]
        final = [s for s in steps if s.kind == "final"]
        if len(intro) != 1 or len(final) != 1:
            st.err(p.line, "ST007", f"{p.id}: нужно ровно одно «было» (знакомство) и одно «стало» (итог)")
            continue
        if steps[0].kind != "intro" or steps[-1].kind != "final":
            st.err(p.line, "ST007", f"{p.id}: история начинается с «было» и заканчивается «стало»")
        middle = [s for s in steps if s.kind in ("step", "band")]
        if len(middle) < 2:
            st.err(p.line, "ST007", f"{p.id}: между «было» и «стало» нужно хотя бы два шага")
        if len(middle) > bs.MAX_STEPS:
            st.warn(p.line, "ST021", f"{p.id}: {len(middle)} шагов (больше {bs.MAX_STEPS}) — сожми историю, детали уйдут в разделы")
        if not intro[0].was:
            st.err(intro[0].line, "ST007", f"{intro[0].id}: у знакомства нужно «Раньше» — как было до инициативы")
        cols = [st.stage_index(s.stage_from) for s in steps]
        if cols != sorted(cols):
            st.err(p.line, "ST007", f"{p.id}: шаги в таблице идут не слева направо по этапам")
        for b in (s for s in steps if s.kind == "band"):
            lo, hi = st.stage_index(b.stage_from), st.stage_index(b.stage_to)
            inside = [s.id for s in steps if s is not b and lo <= st.stage_index(s.stage_from) <= hi]
            if inside:
                st.err(b.line, "ST011", f"{b.id}: полоса ожидания перекрывает шаги {', '.join(inside)} того же персонажа")

    # --- карточки ------------------------------------------------------------------------
    used: set[str] = set()
    for s in st.steps:
        used.update(s.screens)
        limit_text = bs.MAX_TEXT if s.kind in ("step", "band") else 2 * bs.MAX_TEXT
        if not s.title or not s.text:
            st.err(s.line, "ST008", f"{s.id}: нужны заголовок и пояснение")
        if len(s.title) > bs.MAX_TITLE:
            st.err(s.line, "ST008", f"{s.id}: заголовок {len(s.title)} знаков (больше {bs.MAX_TITLE}) — один момент истории")
        if len(s.text) > limit_text:
            st.err(s.line, "ST008", f"{s.id}: пояснение {len(s.text)} знаков (больше {limit_text}) — одна-две фразы")
        if len(s.screens) > bs.MAX_SCREENS:
            st.err(s.line, "ST008", f"{s.id}: {len(s.screens)} экрана на шаге (больше {bs.MAX_SCREENS}) — остальные состояния покажи в деталях раздела")
        if s.kind in ("intro", "final") and s.screens:
            st.err(s.line, "ST011", f"{s.id}: у «было» и «стало» нет экранов — это карточки знакомства и итога")
        if s.kind == "step" and s.stage_from != s.stage_to:
            st.err(s.line, "ST011", f"{s.id}: шаг с экранами стоит в одном этапе; диапазон — только у полосы ожидания")
        if not s.source.strip() or s.source.strip() in bs.EMPTY:
            st.err(s.line, "ST016", f"{s.id}: нет источника — откуда в БФТ этот шаг (How to demo, ПТ, «Изменение в UJM», ответ на вопрос)")
        for txt in (s.title, s.text, s.was):
            m = bs.REQ_RE.search(txt)
            if m:
                st.err(s.line, "ST012", f"{s.id}: «{m.group(0)}» в тексте карточки — ID требований живут в «Источнике»")
                break
            hit = next((pat.search(txt) for pat, _ in API_PATTERNS if pat.search(txt)), None) or TECH_RE.search(txt)
            if hit:
                st.err(s.line, "ST012", f"{s.id}: «{hit.group(0)}» — история рассказывается языком пользователя, без разработки")
                break

    # --- экраны --------------------------------------------------------------------------
    open_where = {q.where for q in st.questions if q.open}
    for sc in st.screens:
        if sc.id not in used:
            st.warn(sc.line, "ST022", f"{sc.id}: экран не стоит ни на одном шаге")
        if sc.view == "неизвестен" and sc.id not in open_where:
            st.err(sc.line, "ST010", f"{sc.id}: экран `неизвестен` — нужен открытый вопрос с «Где» = {sc.id}")
        if not sc.source.strip() or sc.source.strip() in bs.EMPTY:
            st.err(sc.line, "ST016", f"{sc.id}: нет источника экрана (ИТ, ФТ, How to demo или ответ на вопрос)")
        if sc.contour and sc.contour not in bs.EMPTY and not CONTOUR_RE.search(sc.contour):
            st.warn(sc.line, "ST023", f"{sc.id}: контур «{sc.contour}» вне словаря story_line.md — проверь название")

    # --- сверка с БФТ --------------------------------------------------------------------
    if no_source:
        return
    if source is None or not source.is_file():
        st.err(1, "ST013", f"БФТ-источник не найден: {source or st.meta.get('source_doc', '—')}")
        return
    reqs, src_text = bb.load_requirements(source)
    if st.meta.get("source_rev") and st.meta["source_rev"] != bb.source_rev(source):
        st.warn(1, "ST018", "БФТ изменился после сборки (source_rev не совпадает) — пересверь историю")

    cited: set[str] = set()
    for line, owner, src in [(s.line, s.id, s.source) for s in st.steps] + \
                            [(sc.line, sc.id, sc.source) for sc in st.screens] + \
                            [(p.line, p.id, p.source) for p in st.personas]:
        for rid in bs.REQ_RE.findall(src):
            if rid not in reqs:
                st.err(line, "ST014", f"{owner}: {rid} нет в БФТ {source.name}")
            else:
                cited.add(rid)
    for rid in reqs:
        if rid.startswith("ПТ-") and rid not in cited and not team_story(src_text, rid):
            st.warn(1, "ST020", f"{rid} не отражено ни в одном шаге — чья это история?")

    answers = " ".join(q.answer for q in st.questions if not q.open)
    for line, owner, txt in story_texts(st):
        for m in NUM_RE.finditer(txt):
            num = m.group(0).strip(" .,:")
            if num and num not in src_text and num not in answers:
                st.warn(line, "ST017", f"{owner}: число «{num}» не найдено ни в БФТ, ни в ответах")


def resolve_source(st: bs.Story, explicit: str | None) -> Path | None:
    if explicit:
        return Path(explicit)
    doc = st.meta.get("source_doc")
    return (st.path.parent / doc) if doc else None


def run(path: Path, source: str | None, no_source: bool) -> bs.Story:
    st = bs.parse(path)
    if not st.errors:
        check(st, resolve_source(st, source), no_source)
    return st


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("file", type=Path)
    ap.add_argument("--source", help="путь к БФТ (по умолчанию — `source_doc` из frontmatter рядом с файлом)")
    ap.add_argument("--no-source", action="store_true", help="не сверять с БФТ (только форма истории)")
    ap.add_argument("--strict", action="store_true", help="предупреждения тоже дают код 1")
    args = ap.parse_args()
    try:
        st = run(args.file, args.source, args.no_source)
    except OSError as e:
        print(f"{args.file}: не прочитан: {e}", file=sys.stderr)
        return 2
    for i in sorted(st.issues, key=lambda i: (i.level != "ERROR", i.line)):
        print(f"{args.file}:{i.line}: {i.level} {i.code} {i.msg}")
    errors = len(st.errors)
    warns = len(st.issues) - errors
    opened = [q for q in st.questions if q.open]
    for q in opened:
        print(f"  открыт {q.id} → {q.to}: {q.text}")
    steps = sum(1 for s in st.steps if s.kind in ("step", "band"))
    print(f"story-lint: {len(st.personas)} персонаж(а), {steps} шагов, {len(st.screens)} экранов, "
          f"открытых вопросов {len(opened)} — ошибок {errors}, предупреждений {warns}")
    return 1 if errors or (args.strict and warns) else 0


if __name__ == "__main__":
    sys.exit(main())
