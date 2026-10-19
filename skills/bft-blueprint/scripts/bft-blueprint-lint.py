#!/usr/bin/env python3
"""bft-blueprint-lint — машинная проверка `<epic_slug>-blueprint.md` (гейт blueprint).

Структуру разбирает `bft_blueprint.py` (коды BP001–BP010, BP019); здесь — смысл:
покрытие требований БФТ, высота БФТ, заземлённость чисел, читаемость диаграммы.

  ОШИБКИ (код выхода 1)
  BP001–BP010, BP019  структура (см. bft_blueprint.py)
  BP011  пустой обязательный слой: действия, витрина, сервис
  BP012  ФТ/ИТ/НФТ из БФТ не нарисовано ни на одной карточке
  BP013  высота БФТ (гейт 14): в карточке API, протокол, имя таблицы или поля
  BP014  требование из карточки не найдено в БФТ
  BP015  БФТ-источник не найден (`source_doc`); с `--no-source` пропускается
  BP016  карточка длиннее 100 знаков: диаграмма показывает образ, не проработку
  BP017  статус `уточнить` без маркера `[УТОЧНИТЬ …]` в тексте карточки

  ПРЕДУПРЕЖДЕНИЯ (код выхода 1 только с --strict)
  BP018  число в карточке не найдено в тексте БФТ — возможно, выдумано
  BP020  БФТ изменился после сборки (`source_rev` не совпадает)
  BP021  пустой слой: выгода, контакт, основа
  BP022  БТ/ПТ не отражены ни на одной карточке
  BP023  карточка без связей (кроме `уточнить`): не видно, откуда она и куда ведёт
  BP024  в одной ячейке больше трёх карточек: диаграмма перестаёт читаться
  BP025  больше 25 карточек: это уже проработка, а не общая картина

Использование:
    python3 bft-blueprint-lint.py <epic>-blueprint.md [--source БФТ.md | --no-source] [--strict]
Формат вывода: <путь>:<строка>: <УРОВЕНЬ> <КОД> <сообщение>
Коды выхода: 0 — ошибок нет; 1 — ошибки (или предупреждения с --strict); 2 — файл не прочитан.
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bft_blueprint as bb  # noqa: E402

MAX_TEXT = 100
MAX_CELL = 3
MAX_CARDS = 25

# Высота БФТ (гейт 14, bft_standards.md): контракт, протокол и БД — зона СА, не БФТ.
API_PATTERNS = [
    (re.compile(r"\b(?:GET|POST|PUT|PATCH|DELETE)\b"), "HTTP-метод"),
    (re.compile(r"(?<![\w/])/[a-z][\w-]*/[\w{}/.-]+"), "путь эндпоинта"),
    (re.compile(r"(?i)\b(?:endpoint|эндпоинт\w*|REST|gRPC|GraphQL|SOAP|webhook|JSON|payload|топик\w*|kafka|rabbitmq)\b"), "API/протокол"),
    (re.compile(r"(?i)\b(?:SELECT|INSERT|UPDATE|JOIN)\b|\b(?:таблиц\w+|колонк\w+|индекс БД)\s+[`\w]+_[\w]+"), "БД"),
    (re.compile(r"\b[a-z]{2,}_[a-z_]{2,}\b"), "snake_case-идентификатор"),
]
NUM_RE = re.compile(r"\d[\d\s.,:%]*\d|\d")


def requirement_class(rid: str) -> str:
    return rid.split("-")[0]


def check(bp: bb.Blueprint, source: Path | None, no_source: bool) -> None:
    # --- слои ---------------------------------------------------------------
    by_layer = Counter(c.layer for c in bp.cards)
    for layer in ("действия", "витрина", "сервис"):
        if not by_layer[layer]:
            bp.err(1, "BP011", f"слой `{layer}` пуст: без него диаграмма не показывает путь клиента и работу систем")
    for layer in ("выгода", "контакт", "основа"):
        if not by_layer[layer]:
            bp.warn(1, "BP021", f"слой `{layer}` пуст — убедись, что в БФТ для него действительно ничего нет")
    if len(bp.cards) > MAX_CARDS:
        bp.warn(1, "BP025", f"{len(bp.cards)} карточек (больше {MAX_CARDS}): сожми до общей картины, детали живут в БФТ")

    # --- карточки ------------------------------------------------------------
    cell = Counter((c.lane, c.stage) for c in bp.cards)
    for (lane, stage), n in cell.items():
        if n > MAX_CELL:
            first = next(c for c in bp.cards if (c.lane, c.stage) == (lane, stage))
            bp.warn(first.line, "BP024", f"в ячейке «{lane} × {stage}» {n} карточек (больше {MAX_CELL})")
    linked = {x.src for x in bp.links} | {x.dst for x in bp.links}
    for c in bp.cards:
        if len(c.text) > MAX_TEXT:
            bp.err(c.line, "BP016", f"{c.id}: {len(c.text)} знаков (больше {MAX_TEXT}) — сократи до образа")
        for pat, what in API_PATTERNS:
            m = pat.search(c.text)
            if m:
                bp.err(c.line, "BP013", f"{c.id}: {what} «{m.group(0)}» — API, протоколы и БД вне высоты БФТ")
                break
        if c.kind == "уточнить" and bb.MARKER not in c.text:
            bp.err(c.line, "BP017", f"{c.id}: статус `уточнить` требует `[УТОЧНИТЬ у {{кого}}]` в тексте")
        if c.id not in linked and c.kind != "уточнить" and len(bp.cards) > 1:
            bp.warn(c.line, "BP023", f"{c.id}: нет ни одной связи")

    # --- сверка с БФТ --------------------------------------------------------
    if no_source:
        return
    if source is None or not source.is_file():
        bp.err(1, "BP015", f"БФТ-источник не найден: {source or bp.meta.get('source_doc', '—')}")
        return
    reqs, src_text = bb.load_requirements(source)
    if bp.meta.get("source_rev") and bp.meta["source_rev"] != bb.source_rev(source):
        bp.warn(1, "BP020", "БФТ изменился после сборки (source_rev не совпадает) — пересверь blueprint")

    drawn: set[str] = set()
    for c in bp.cards:
        for rid in c.reqs:
            if rid not in reqs:
                bp.err(c.line, "BP014", f"{c.id}: {rid} нет в БФТ {source.name}")
            else:
                drawn.add(rid)
        for tok in bb.REQ_RE.findall(c.text):
            if tok not in reqs:
                bp.err(c.line, "BP014", f"{c.id}: {tok} в тексте карточки нет в БФТ")
        scrubbed = bb.REQ_RE.sub("", re.sub(r"[СК]\d+", "", c.text))
        for m in NUM_RE.finditer(scrubbed):
            num = m.group(0).strip(" .,:")
            if num and num not in src_text:
                bp.warn(c.line, "BP018", f"{c.id}: число «{num}» не найдено в БФТ")

    for rid, name in reqs.items():
        if rid in drawn:
            continue
        if requirement_class(rid) in ("ФТ", "ИТ", "НФТ"):
            bp.err(1, "BP012", f"{rid} не нарисовано: добавь карточку с этим требованием (или `уточнить`, если место неизвестно)")
        else:
            bp.warn(1, "BP022", f"{rid} не отражено на диаграмме")


def resolve_source(bp: bb.Blueprint, explicit: str | None) -> Path | None:
    if explicit:
        return Path(explicit)
    doc = bp.meta.get("source_doc")
    return (bp.path.parent / doc) if doc else None


def run(path: Path, source: str | None, no_source: bool) -> bb.Blueprint:
    bp = bb.parse(path)
    # Структура сломана — смысловые проверки дали бы лавину ложных ошибок.
    if not bp.errors:
        check(bp, resolve_source(bp, source), no_source)
    return bp


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("file", type=Path)
    ap.add_argument("--source", help="путь к БФТ (по умолчанию — `source_doc` из frontmatter рядом с файлом)")
    ap.add_argument("--no-source", action="store_true", help="не сверять с БФТ (только структура и высота)")
    ap.add_argument("--strict", action="store_true", help="предупреждения тоже дают код 1")
    args = ap.parse_args()
    try:
        bp = run(args.file, args.source, args.no_source)
    except OSError as e:
        print(f"{args.file}: не прочитан: {e}", file=sys.stderr)
        return 2
    for i in sorted(bp.issues, key=lambda i: (i.level != "ERROR", i.line)):
        print(f"{args.file}:{i.line}: {i.level} {i.code} {i.msg}")
    errors = len(bp.errors)
    warns = len(bp.issues) - errors
    print(f"blueprint-lint: {len(bp.cards)} карточек, {len(bp.links)} связей — ошибок {errors}, предупреждений {warns}")
    return 1 if errors or (args.strict and warns) else 0


if __name__ == "__main__":
    sys.exit(main())
