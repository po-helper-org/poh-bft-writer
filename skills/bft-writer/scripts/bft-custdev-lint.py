#!/usr/bin/env python3
"""bft-custdev-lint — линтер скрипта проблемного интервью (гейт 22).

Скрипт строит `/bft-custdev` по методологии «Awesome Problem Interview Script»
(Сергей Тихомиров, productframework.ru). Ценность скрипта держится на том, что
проверяется однозначно, и это проверяется машинно, а не самоотчётом модели:

  * гипотеза собрана из четырёх блоков, и у каждого назван источник (`CD002`);
  * метрика блокера и метрика цели — одна метрика, опора «качелей» (`CD003`);
  * вопросов столько, сколько влезает в разговор на 5–10 минут (`CD004`);
  * вопрос привязан к блоку гипотезы, иначе он ничего не проверяет (`CD005`);
  * у вопроса есть пробел-источник и адресат (`CD007`, `CD008`).

Канон методички — источник форм вопроса, а не сценарий обхода: полные 14 этапов
рассчитаны на 45–60 минут исследования незнакомой персоны, а здесь закрывают
конкретные пробелы документа (`skills/bft-custdev/resources/script_stages.md`).

Форма вопроса проверяется предупреждением, а не отказом (`CD011`–`CD015`): канон
сам держит закрытые уточнения, и жёсткий отказ по форме отверг бы источник.
Решает человек.

Формат документа — `skills/bft-custdev/resources/document_assembly.md`.

Использование:
    python3 scripts/bft-custdev-lint.py <epic-custdev.md> [...]
    python3 scripts/bft-custdev-lint.py --format json <epic-custdev.md>

Коды выхода: 0 — ошибок нет; 1 — есть ERROR; 2 — файл не прочитан.
Формат вывода: <путь>:<строка>: <УРОВЕНЬ> <КОД> <сообщение>
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path

FRONTMATTER_KEYS = ["epic_slug", "stage", "prepared", "source", "respondent", "questions"]

# Разделы документа. Порядок — как их читает PO; все обязательны (CD009).
SECTIONS = [
    "## Гипотеза проблемы",
    "## Цели интервью",
    "## Участники",
    "## Вопросы",
    "## Чего не спрашиваем",
    "## После интервью",
]

# Интервью на 5–10 минут. Тридцать вопросов канона дают воду и вопросы не по делу —
# проверено на живом прогоне, см. script_stages.md §«Правило длины». Границы шире
# рекомендованных 6–9: линтер ловит вырождение, а не спорит о девятом вопросе.
MIN_QUESTIONS = 3
MAX_QUESTIONS = 12
QUESTION_WORDS = 15
INTENT_WORDS = 8

# Шаг 1 методички: Person + Problem + Cause + Motivation = Problem Hypothesis.
HYPOTHESIS_BLOCKS = ["Person", "Problem", "Cause", "Motivation"]
HYPOTHESIS_HEADER = ["Блок", "Формулировка", "Источник"]

# Три строки метрики. Метрика одна: форма не даёт ей разойтись между проблемой и целью.
METRIC_LINES = [
    "**Метрика:**",
    "**Проблема понижает метрику:**",
    "**Мотивация повышает метрику:**",
]

QUESTIONS_HEADER = ["#", "Вопрос", "Что хотим узнать", "Кому", "Пробел"]

# Тег блока гипотезы в конце вопроса. Без него вопрос не бьёт ни в поведение, ни в
# метрику, ни в мотивацию, ни в причину — и не проверяет гипотезу.
BLOCK_TAGS = {"Поведение", "Метрика блокера", "Мотивация", "Причина"}
TAG_RE = re.compile(r"\((Поведение|Метрика блокера|Мотивация|Причина)\)\s*$")

PARTICIPANTS_HEADER = ["ФИО", "Роль", "Что хотим узнать"]
# Источник блока гипотезы: цитата, честное «это моя гипотеза из такой-то дырки» или [УТОЧНИТЬ].
SOURCE_OK_RE = re.compile(r"гипотеза\s*←|\[УТОЧНИТЬ|«|\.md\b|\.csv\b")

CLOSED_RE = re.compile(r"\bли\b")
ANCHOR_RE = re.compile(r"потому что|из-за того, что|так как")
HYPOTHETICAL_RE = re.compile(r"в идеале|идеальн|хотели бы вы|стали бы вы|пользовались бы|если бы у вас")

PLACEHOLDER_RE = re.compile(r"^[-—\s]*$")


@dataclass
class Finding:
    line: int
    level: str  # ERROR | WARN
    code: str
    message: str


def parse_frontmatter(lines: list[str]) -> tuple[dict[str, str], int]:
    """Возвращает (ключи, 1-based номер закрывающей ---). Нет фронтматтера — ({}, 0)."""
    if not lines or lines[0].strip() != "---":
        return {}, 0
    fm: dict[str, str] = {}
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return fm, i + 1
        m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", lines[i])
        if m:
            fm[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return fm, 0


def find_heading(lines: list[str], exact: str) -> int:
    for idx, raw in enumerate(lines, start=1):
        if raw.rstrip() == exact:
            return idx
    return 0


def section_bounds(lines: list[str], start: int) -> int:
    """Номер последней строки раздела, начатого на `start` (до следующего '## ')."""
    for idx in range(start + 1, len(lines) + 1):
        if lines[idx - 1].startswith("## "):
            return idx - 1
    return len(lines)


def table_rows(lines: list[str], start: int, end: int) -> list[tuple[int, list[str]]]:
    """Строки markdown-таблицы в диапазоне (1-based, включительно), без разделителей."""
    rows: list[tuple[int, list[str]]] = []
    for idx in range(start, min(end, len(lines)) + 1):
        raw = lines[idx - 1].strip()
        if not (raw.startswith("|") and raw.endswith("|")):
            continue
        cells = [c.strip() for c in raw.strip("|").split("|")]
        if set("".join(cells)) <= set("-: "):
            continue
        rows.append((idx, cells))
    return rows


def questions_of(cell: str) -> list[str]:
    """Вопросы одной ячейки: разделитель `<br>`, пустые фрагменты отбрасываются."""
    return [q.strip() for q in re.split(r"<br\s*/?>", cell) if q.strip()]


def check_frontmatter(lines: list[str], out: list[Finding]) -> int:
    fm, fm_end = parse_frontmatter(lines)
    if not fm_end:
        out.append(Finding(1, "ERROR", "CD001", "нет frontmatter — скрипт без epic_slug и даты непривязываем"))
        return 0
    missing = [k for k in FRONTMATTER_KEYS if k not in fm]
    if missing:
        out.append(Finding(1, "ERROR", "CD001", f"во frontmatter нет ключей: {', '.join(missing)}"))
    if fm.get("stage") and fm["stage"] != "custdev":
        out.append(Finding(1, "ERROR", "CD001",
                           f"stage: {fm['stage']} — скрипт интервью не документ БФТ, ожидалось stage: custdev"))
    return fm_end


def check_sections(lines: list[str], out: list[Finding]) -> dict[str, int]:
    found: dict[str, int] = {}
    for heading in SECTIONS:
        line = find_heading(lines, heading)
        if line:
            found[heading] = line
        else:
            out.append(Finding(len(lines), "ERROR", "CD009", f"нет раздела «{heading}»"))
    return found


def check_hypothesis(lines: list[str], start: int, out: list[Finding]) -> None:
    end = section_bounds(lines, start)
    rows = table_rows(lines, start, end)
    if not rows:
        out.append(Finding(start, "ERROR", "CD002", "под «Гипотеза проблемы» нет таблицы блоков"))
    else:
        header_idx, header = rows[0]
        if header != HYPOTHESIS_HEADER:
            out.append(Finding(header_idx, "ERROR", "CD002",
                               f"колонки таблицы гипотезы: ожидались {' | '.join(HYPOTHESIS_HEADER)}"))
        seen: dict[str, tuple[int, list[str]]] = {}
        for idx, cells in rows[1:]:
            if len(cells) != len(HYPOTHESIS_HEADER):
                out.append(Finding(idx, "ERROR", "CD002",
                                   f"в строке гипотезы {len(cells)} колонок вместо {len(HYPOTHESIS_HEADER)}"))
                continue
            seen[cells[0]] = (idx, cells)
        for block in HYPOTHESIS_BLOCKS:
            if block not in seen:
                out.append(Finding(start, "ERROR", "CD002",
                                   f"в гипотезе нет блока {block} — формула Person + Problem + Cause + Motivation неполна"))
                continue
            idx, cells = seen[block]
            _, formulation, source = cells
            if not formulation or PLACEHOLDER_RE.match(formulation):
                out.append(Finding(idx, "ERROR", "CD002", f"блок {block}: пустая формулировка"))
            if not source or PLACEHOLDER_RE.match(source):
                out.append(Finding(idx, "ERROR", "CD002", f"блок {block}: пустая колонка «Источник»"))
            elif not SOURCE_OK_RE.search(source):
                out.append(Finding(idx, "ERROR", "CD002",
                                   f"блок {block}: источник «{source}» не опознан — нужна цитата, "
                                   "«гипотеза ← <маркер> · <место>» или [УТОЧНИТЬ]"))

    text = {}
    for idx in range(start, min(end, len(lines)) + 1):
        raw = lines[idx - 1].strip()
        for marker in METRIC_LINES:
            if raw.startswith(marker):
                text[marker] = (idx, raw[len(marker):].strip())
    for marker in METRIC_LINES:
        if marker not in text:
            out.append(Finding(start, "ERROR", "CD003",
                               f"нет строки «{marker}» — качели без общей опоры, гипотезу нечем измерить"))
        elif not text[marker][1]:
            out.append(Finding(text[marker][0], "ERROR", "CD003", f"строка «{marker}» пуста"))


def check_goals(lines: list[str], start: int, out: list[Finding]) -> None:
    end = section_bounds(lines, start)
    goals = 0
    for idx in range(start, min(end, len(lines)) + 1):
        raw = lines[idx - 1].strip()
        if not re.match(r"^\d+\.\s+\S", raw):
            continue
        goals += 1
        if "←" not in raw:
            out.append(Finding(idx, "ERROR", "CD007",
                               "цель интервью без пробела-источника: непонятно, какую дырку она закрывает"))
    if not goals:
        out.append(Finding(start, "ERROR", "CD007", "под «Цели интервью» нет ни одной цели"))


def check_participants(lines: list[str], start: int, out: list[Finding]) -> None:
    end = section_bounds(lines, start)
    rows = table_rows(lines, start, end)
    if not rows:
        out.append(Finding(start, "ERROR", "CD008", "под «Участники» нет таблицы"))
        return
    header_idx, header = rows[0]
    if header != PARTICIPANTS_HEADER:
        out.append(Finding(header_idx, "ERROR", "CD008",
                           f"колонки таблицы участников: ожидались {' | '.join(PARTICIPANTS_HEADER)}"))
    if len(rows) < 2:
        out.append(Finding(start, "ERROR", "CD008", "в таблице участников нет ни одной строки"))
    for idx, cells in rows[1:]:
        if len(cells) != len(PARTICIPANTS_HEADER):
            out.append(Finding(idx, "ERROR", "CD008",
                               f"в строке участника {len(cells)} колонок вместо {len(PARTICIPANTS_HEADER)}"))
            continue
        name, role, why = cells
        if not name or PLACEHOLDER_RE.match(name):
            out.append(Finding(idx, "ERROR", "CD008", "участник без имени: адресовать вопрос некому"))
        if not role or PLACEHOLDER_RE.match(role):
            out.append(Finding(idx, "ERROR", "CD008", f"участник «{name}» без роли"))
        if not why or PLACEHOLDER_RE.match(why):
            out.append(Finding(idx, "ERROR", "CD008",
                               f"участник «{name}»: пусто «Что хотим узнать» — зачем его звать"))


def check_questions(lines: list[str], start: int, out: list[Finding]) -> None:
    end = section_bounds(lines, start)
    rows = table_rows(lines, start, end)
    if not rows:
        out.append(Finding(start, "ERROR", "CD004", "под «Вопросы» нет таблицы"))
        return
    header_idx, header = rows[0]
    if header != QUESTIONS_HEADER:
        out.append(Finding(header_idx, "ERROR", "CD004",
                           f"колонки вопросов: ожидались {' | '.join(QUESTIONS_HEADER)}"))

    body = rows[1:]
    if len(body) < MIN_QUESTIONS:
        out.append(Finding(start, "ERROR", "CD004",
                           f"вопросов {len(body)} — интервью не о чем вести, минимум {MIN_QUESTIONS}"))
    if len(body) > MAX_QUESTIONS:
        out.append(Finding(start, "ERROR", "CD004",
                           f"вопросов {len(body)} — встреча в 5–10 минут не уложится, максимум {MAX_QUESTIONS}"))

    for idx, cells in body:
        if len(cells) != len(QUESTIONS_HEADER):
            out.append(Finding(idx, "ERROR", "CD004",
                               f"в строке вопроса {len(cells)} колонок вместо {len(QUESTIONS_HEADER)}"))
            continue
        num, question, intent, whom, gap = cells

        if not question or PLACEHOLDER_RE.match(question):
            out.append(Finding(idx, "ERROR", "CD004", f"{num}: пустой вопрос"))
            continue

        tag = TAG_RE.search(question)
        if not tag:
            out.append(Finding(idx, "ERROR", "CD005",
                               f"{num}: вопрос без тега блока гипотезы "
                               f"({', '.join(sorted(BLOCK_TAGS))}) — он ничего не проверяет"))
        if not gap or PLACEHOLDER_RE.match(gap):
            out.append(Finding(idx, "ERROR", "CD007",
                               f"{num}: пустой пробел-источник — вопрос никто не заказывал, он выдуман"))
        if not whom or PLACEHOLDER_RE.match(whom):
            out.append(Finding(idx, "ERROR", "CD008",
                               f"{num}: пустая колонка «Кому» — неизвестный адресат пишется как [кому?], не пустотой"))
        if not intent or PLACEHOLDER_RE.match(intent):
            out.append(Finding(idx, "ERROR", "CD004", f"{num}: пусто «Что хотим узнать»"))

        text = TAG_RE.sub("", question).strip()
        first_sentence = re.split(r"[?!.]", text)[0]
        if CLOSED_RE.search(first_sentence):
            out.append(Finding(idx, "WARN", "CD011", f"{num}: вопрос закрытый (да/нет) — «{text[:60]}»"))
        if ANCHOR_RE.search(text):
            out.append(Finding(idx, "WARN", "CD012", f"{num}: ответ подсказан в вопросе (эффект якоря)"))
        if HYPOTHETICAL_RE.search(text.lower()):
            out.append(Finding(idx, "WARN", "CD013", f"{num}: описание «в идеале» вместо кейса использования"))

        words = len(text.split())
        if words > QUESTION_WORDS or text.count("?") > 1:
            out.append(Finding(idx, "WARN", "CD014",
                               f"{num}: вопрос из {words} слов и {text.count('?')} знаков — "
                               f"держим до {QUESTION_WORDS} слов и одного вопроса"))
        if intent and len(intent.split()) > INTENT_WORDS:
            out.append(Finding(idx, "WARN", "CD015",
                               f"{num}: «Что хотим узнать» из {len(intent.split())} слов, держим до {INTENT_WORDS}"))


def lint(path: Path) -> list[Finding]:
    lines = path.read_text(encoding="utf-8").split("\n")
    out: list[Finding] = []

    check_frontmatter(lines, out)
    found = check_sections(lines, out)

    checks = {
        "## Гипотеза проблемы": check_hypothesis,
        "## Цели интервью": check_goals,
        "## Участники": check_participants,
        "## Вопросы": check_questions,
    }
    for heading, check in checks.items():
        if heading in found:
            check(lines, found[heading], out)

    return sorted(out, key=lambda f: (f.line, f.code))


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Линтер скрипта проблемного интервью /bft-custdev")
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--format", choices=["text", "json"], default="text")
    args = parser.parse_args(argv)

    report: dict[str, list[dict]] = {}
    errors = 0
    for path in args.files:
        if not path.is_file():
            print(f"{path}: ERROR IO001 файл не найден", file=sys.stderr)
            return 2
        findings = lint(path)
        report[str(path)] = [asdict(f) for f in findings]
        errors += sum(1 for f in findings if f.level == "ERROR")
        if args.format == "text":
            for f in findings:
                print(f"{path}:{f.line}: {f.level} {f.code} {f.message}")
            if not any(f.level == "ERROR" for f in findings):
                print(f"{path}: OK — скрипт следует методологии")

    if args.format == "json":
        print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
