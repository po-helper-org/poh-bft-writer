#!/usr/bin/env python3
"""bft-custdev-lint — линтер скрипта проблемного интервью (гейт 22).

Скрипт строит `/bft-custdev` по методологии «Awesome Problem Interview Script»
(Сергей Тихомиров, productframework.ru). Ценность скрипта держится на том, что
проверяется однозначно, и это проверяется машинно, а не самоотчётом модели:

  * гипотеза собрана из четырёх блоков, и у каждого назван источник (`CD002`);
  * метрика блокера и метрика цели — одна метрика, опора «качелей» (`CD003`);
  * канон из 14 этапов на месте и в порядке (`CD004`);
  * вопрос потока верификации привязан к блоку гипотезы (`CD005`);
  * дополнительная гипотеза записана формулой своего типа (`CD006`);
  * у гипотезы есть пробел-источник и адресат (`CD007`, `CD008`).

Форма вопроса проверяется предупреждением, а не отказом (`CD011`–`CD013`): канон
методички сам держит закрытые и гипотетические уточнения внутри ячеек, и жёсткий
отказ по форме отверг бы источник. Решает человек.

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

FRONTMATTER_KEYS = ["epic_slug", "stage", "prepared", "source", "respondent", "hypotheses"]

# Разделы документа. Порядок — как их читает PO; все обязательны (CD009).
SECTIONS = [
    "## Гипотеза проблемы",
    "## Цели интервью",
    "## План мероприятия",
    "## Участники",
    "## Скрипт интервью",
    "## Уточняющие контекстные вопросы",
    "## Дополнительные гипотезы",
    "## Чего не спрашиваем",
    "## После интервью",
]

# Шаг 1 методички: Person + Problem + Cause + Motivation = Problem Hypothesis.
HYPOTHESIS_BLOCKS = ["Person", "Problem", "Cause", "Motivation"]
HYPOTHESIS_HEADER = ["Блок", "Формулировка", "Источник"]

# Три строки метрики. Метрика одна: форма не даёт ей разойтись между проблемой и целью.
METRIC_LINES = [
    "**Метрика:**",
    "**Проблема понижает метрику:**",
    "**Мотивация повышает метрику:**",
]

# Шаг 2: 14 этапов канона, порядок фиксирован (слева-направо, сверху-вниз).
STAGES = [
    "Общий вопрос про поведение в рамках исследуемой гипотезы",
    "Получение примера работы",
    "Анализ частотности поведения",
    "Анализ инструментария",
    "Уточнение проблемы в рамках гипотезы",
    "Уточнение проблемы: дополнительные вопросы",
    "Выяснение эмоций",
    "Последствия",
    "Уточнение наличия блокера для проблемы",
    "Валидация влияния на цель",
    "Уточнение текущего решения",
    "Другие способы решения",
    "«Волшебная палочка»",
    "Обратный вопрос",
]
SCRIPT_HEADER = ["Этап", "Поток верификации гипотезы", "Поток получения новых знаний"]

# Этапы 13 и 14 — «Завершение»: они выходят за поток верификации и тегов не несут.
CLOSING_STAGES = {"«Волшебная палочка»", "Обратный вопрос"}
# Гипотетическая форма санкционирована каноном на этих двух этапах.
HYPOTHETICAL_OK = {"Уточнение проблемы: дополнительные вопросы", "«Волшебная палочка»"}

BLOCK_TAGS = {"Поведение", "Метрика блокера", "Мотивация", "Причина"}
TAG_RE = re.compile(r"\((Поведение|Метрика блокера|Мотивация|Причина)\)\s*$")

PARTICIPANTS_HEADER = ["ФИО", "Роль", "Зачем на интервью", "Блоки вопросов"]
EXTRA_HEADER = ["#", "Тип", "Формулировка", "Пробел-источник", "Кому", "Вопрос на встрече"]

# Шаг 3: пять типов дополнительных гипотез и связки их формул.
HYPOTHESIS_FORMULAS = {
    "поведения": (("Когда ",), (", то ", ", потому что ")),
    "проблемы": (("Когда ",), (", то ", ", а это мешает ")),
    "мотивации": ((), (" хочет", ", а не ", ", чтобы ")),
    "блокера": ((), (", потому что ",)),
    "решения": (("Если ",), (" предоставить ", ", то можно будет решить ", ", что можно подтвердить с помощью ")),
}

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
        name, role, why, _ = cells
        if not name or PLACEHOLDER_RE.match(name):
            out.append(Finding(idx, "ERROR", "CD008", "участник без имени: адресовать вопрос некому"))
        if not role or PLACEHOLDER_RE.match(role):
            out.append(Finding(idx, "ERROR", "CD008", f"участник «{name}» без роли"))
        if not why or PLACEHOLDER_RE.match(why):
            out.append(Finding(idx, "ERROR", "CD008",
                               f"участник «{name}»: пустая колонка «Зачем на интервью» — зачем его звать"))


def check_script(lines: list[str], start: int, out: list[Finding]) -> None:
    end = section_bounds(lines, start)
    rows = table_rows(lines, start, end)
    if not rows:
        out.append(Finding(start, "ERROR", "CD004", "под «Скрипт интервью» нет таблицы этапов"))
        return
    header_idx, header = rows[0]
    if header != SCRIPT_HEADER:
        out.append(Finding(header_idx, "ERROR", "CD004",
                           f"колонки скрипта: ожидались {' | '.join(SCRIPT_HEADER)}"))

    body = rows[1:]
    names = [cells[0] for _, cells in body if cells]
    if names != STAGES:
        missing = [s for s in STAGES if s not in names]
        extra = [s for s in names if s not in STAGES]
        if missing:
            out.append(Finding(start, "ERROR", "CD004",
                               f"в скрипте нет этапов канона: {'; '.join(missing)}"))
        if extra:
            out.append(Finding(start, "ERROR", "CD004",
                               f"в скрипте есть этапы вне канона: {'; '.join(extra)}"))
        if not missing and not extra:
            out.append(Finding(start, "ERROR", "CD004",
                               "порядок этапов нарушен: вопросы задаются сверху-вниз, порядок канона фиксирован"))

    for idx, cells in body:
        if len(cells) != len(SCRIPT_HEADER):
            out.append(Finding(idx, "ERROR", "CD004",
                               f"в строке этапа {len(cells)} колонок вместо {len(SCRIPT_HEADER)}"))
            continue
        stage, verify, discover = cells
        if not questions_of(verify) and not questions_of(discover):
            out.append(Finding(idx, "ERROR", "CD004", f"этап «{stage}»: обе ячейки пусты"))
            continue

        verify_questions = questions_of(verify)
        if stage not in CLOSING_STAGES:
            for question in verify_questions:
                if not TAG_RE.search(question):
                    out.append(Finding(idx, "ERROR", "CD005",
                                       f"этап «{stage}»: вопрос потока верификации без тега блока гипотезы "
                                       f"({', '.join(sorted(BLOCK_TAGS))}) — «{question[:60]}»"))

        for flow_questions in (verify_questions, questions_of(discover)):
            for position, question in enumerate(flow_questions):
                first_sentence = re.split(r"[?!.]", question)[0]
                if position == 0 and CLOSED_RE.search(first_sentence):
                    out.append(Finding(idx, "WARN", "CD011",
                                       f"этап «{stage}»: ведущий вопрос ячейки закрытый — «{question[:60]}»"))
                if ANCHOR_RE.search(question):
                    out.append(Finding(idx, "WARN", "CD012",
                                       f"этап «{stage}»: ответ подсказан в вопросе (эффект якоря) — «{question[:60]}»"))
                if stage not in HYPOTHETICAL_OK and HYPOTHETICAL_RE.search(question.lower()):
                    out.append(Finding(idx, "WARN", "CD013",
                                       f"этап «{stage}»: описание «в идеале» вместо кейса использования — «{question[:60]}»"))


def check_extra_hypotheses(lines: list[str], start: int, out: list[Finding]) -> None:
    end = section_bounds(lines, start)
    rows = table_rows(lines, start, end)
    if not rows:
        out.append(Finding(start, "ERROR", "CD006", "под «Дополнительные гипотезы» нет таблицы"))
        return
    header_idx, header = rows[0]
    if header != EXTRA_HEADER:
        out.append(Finding(header_idx, "ERROR", "CD006",
                           f"колонки дополнительных гипотез: ожидались {' | '.join(EXTRA_HEADER)}"))
    for idx, cells in rows[1:]:
        if len(cells) != len(EXTRA_HEADER):
            out.append(Finding(idx, "ERROR", "CD006",
                               f"в строке гипотезы {len(cells)} колонок вместо {len(EXTRA_HEADER)}"))
            continue
        num, kind, formulation, gap, whom, question = cells
        if kind not in HYPOTHESIS_FORMULAS:
            out.append(Finding(idx, "ERROR", "CD006",
                               f"{num}: тип «{kind}» не из пяти: {', '.join(HYPOTHESIS_FORMULAS)}"))
        else:
            prefixes, parts = HYPOTHESIS_FORMULAS[kind]
            if prefixes and not any(formulation.startswith(p) for p in prefixes):
                out.append(Finding(idx, "ERROR", "CD006",
                                   f"{num}: гипотеза {kind} должна начинаться с «{prefixes[0].strip()}»"))
            lost = [p for p in parts if p not in formulation]
            if lost:
                out.append(Finding(idx, "ERROR", "CD006",
                                   f"{num}: гипотеза {kind} не по формуле, нет связок: "
                                   + "; ".join(f"«{p.strip()}»" for p in lost)))
        if not gap or PLACEHOLDER_RE.match(gap):
            out.append(Finding(idx, "ERROR", "CD007",
                               f"{num}: пустой пробел-источник — гипотезу никто не заказывал, она выдумана"))
        if not whom or PLACEHOLDER_RE.match(whom):
            out.append(Finding(idx, "ERROR", "CD008",
                               f"{num}: пустая колонка «Кому» — неизвестный адресат пишется как [кому?], не пустотой"))
        if not question or PLACEHOLDER_RE.match(question):
            out.append(Finding(idx, "ERROR", "CD006", f"{num}: нет вопроса на встрече"))


def lint(path: Path) -> list[Finding]:
    lines = path.read_text(encoding="utf-8").split("\n")
    out: list[Finding] = []

    check_frontmatter(lines, out)
    found = check_sections(lines, out)

    checks = {
        "## Гипотеза проблемы": check_hypothesis,
        "## Цели интервью": check_goals,
        "## Участники": check_participants,
        "## Скрипт интервью": check_script,
        "## Дополнительные гипотезы": check_extra_hypotheses,
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
