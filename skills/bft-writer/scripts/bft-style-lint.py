#!/usr/bin/env python3
"""bft-style-lint — лексический линтер артефактов БФТ на AI-слоп.

Проверяет текст на стоп-слова, хеджи, интенсификаторы и мета-комментарии
из `resources/writing_style.md` §1 (AI-словарь) и §1a (anti-slop). Дополняет
`bft-lint.py`: тот проверяет структуру документа, этот — регистр текста.
Обе проверки машинные — не полагаются на самооценку LLM (гейт 18,
`resources/hard_gates.md`).

Применяется к любому артефакту пайплайна (context-pack, problem.md,
concept.md, черновик БФТ, validation.md), а не только к финальному документу
с frontmatter — в отличие от bft-lint.py здесь нет требования к канону.

Не применяется к самим файлам правил (`resources/writing_style.md`,
`resources/hard_gates.md`): они цитируют запрещённые обороты, чтобы их
запретить, и срабатывание на цитате — ложное.

Использование:
    python3 scripts/bft-style-lint.py <файл.md> [<файл.md> ...]
    python3 scripts/bft-style-lint.py --format json <файл.md>

Коды выхода: 0 — совпадений нет; 1 — есть совпадения; 2 — файл не прочитан.
Формат вывода: <путь>:<строка>: <УРОВЕНЬ> <КОД> <сообщение> — «<фрагмент>»
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path


@dataclass(frozen=True)
class Pattern:
    code: str
    regex: re.Pattern
    message: str


def _p(code: str, phrase: str, message: str) -> Pattern:
    return Pattern(code, re.compile(r"(?i)\b" + phrase + r"\b"), message)


# --- Словарь anti-slop (writing_style.md §1 — AI-словарь) -------------------

STOP_WORDS: list[Pattern] = [
    _p("SW001", r"позволя(ет|ют)", "стоп-слово «позволяет» — прямое сказуемое вместо накачанного"),
    _p("SW002", r"обеспечива(ет|ют)", "стоп-слово «обеспечивает» — прямой глагол («обеспечивает хранение» → «хранит»)"),
    _p("SW003", r"осуществля(ет|ют)", "стоп-слово «осуществляет» — прямой глагол («осуществляет возврат» → «возвращает»)"),
    _p("SW004", r"производ(ит|ят)", "стоп-слово «производит» — прямой глагол («производит логирование» → «логирует»)"),
    _p("SW005", r"способствует", "стоп-слово «способствует» — убрать конструкцию («способствует росту» → «растёт»)"),
    _p("SW006", r"представляет собой", "стоп-фраза «представляет собой» — «есть»/«это»"),
    _p("SW007", r"важно отметить,?\s*что", "стоп-фраза «важно отметить, что» — убрать, начать с утверждения"),
    _p("SW008", r"следует отметить,?\s*что", "стоп-фраза «следует отметить, что» — убрать"),
    _p("SW009", r"необходимо учитывать,?\s*что", "стоп-фраза «необходимо учитывать, что» — убрать"),
    _p("SW010", r"в рамках данного документа", "стоп-фраза «в рамках данного документа» — «в данном документе»"),
    _p("SW011", r"настоящий документ", "стоп-фраза «настоящий документ» — «документ»/«БФТ»"),
    _p("SW012", r"в настоящее время", "стоп-фраза «в настоящее время» — «сейчас» или убрать"),
    _p("SW013", r"в случае возникновения", "стоп-фраза «в случае возникновения» — «при» («при ошибке»)"),
    _p("SW014", r"в связи с тем,?\s*что", "стоп-фраза «в связи с тем, что» — «так как»/«потому что»"),
    _p("SW015", r"с целью", "стоп-фраза «с целью» — «для» («с целью обеспечения» → «для»)"),
]

# --- Хеджи / мета-комментарии / интенсификаторы (writing_style.md §1a) ------

HEDGES: list[Pattern] = [
    _p("HG001", r"может потенциально", "хедж «может потенциально» — прямое утверждение или [УТОЧНИТЬ]"),
    _p("HG002", r"в некоторых случаях", "хедж «в некоторых случаях» без конкретики"),
    _p("HG003", r"как правило", "хедж «как правило» без конкретики"),
    _p("HG004", r"в определ[её]нной степени", "хедж «в определённой степени»"),
    _p("HG005", r"есть основания полагать", "хедж «есть основания полагать»"),
]

META: list[Pattern] = [
    _p("MC001", r"в данном разделе рассматрива(ется|ются)", "мета-комментарий — сразу писать содержание, без анонса"),
    _p("MC002", r"важно понимать,?\s*что", "мета-комментарий «важно понимать, что»"),
    _p("MC003", r"начн[её]м с рассмотрения", "мета-комментарий «начнём с рассмотрения»"),
    _p("MC004", r"ниже описаны", "signposting «ниже описаны» — сразу писать содержимое"),
    _p("MC005", r"перейдём к", "signposting «перейдём к»"),
]

QUALIFIERS: list[Pattern] = [
    _p("QF001", r"полностью завершить", "избыточный квалификатор «полностью завершить» → «завершить»"),
    _p("QF002", r"абсолютно необходимо", "избыточный квалификатор «абсолютно необходимо» → «необходимо»"),
    _p("QF003", r"крайне важно", "избыточный квалификатор «крайне важно» — дать приоритет/гейт, не оценку"),
    _p("QF004", r"совершенно уникальн\w*", "пустой интенсификатор «совершенно уникальный»"),
    _p("QF005", r"очень значительн\w*", "пустой интенсификатор «очень значительный»"),
    _p("QF006", r"действительно критичн\w*", "пустой интенсификатор «действительно критичный»"),
]

# --- Corporate buzzword (англ. калька, §1a) ---------------------------------

BUZZWORDS: list[Pattern] = [
    _p("BZ001", r"leverage", "buzzword «leverage» — «использовать»"),
    _p("BZ002", r"utilize", "buzzword «utilize» — «использовать»"),
    _p("BZ003", r"holistic", "buzzword «holistic» — конкретный охват вместо оценки"),
    _p("BZ004", r"synergistic|synergy", "buzzword «synergistic/synergy»"),
    _p("BZ005", r"game[- ]changer", "buzzword «game-changer»"),
    _p("BZ006", r"next[- ]generation", "buzzword «next-generation» — конкретная версия/дата"),
    _p("BZ007", r"empower(s|ed|ing)?", "buzzword «empower» — прямой глагол с объектом действия"),
]

ALL_PATTERNS: list[Pattern] = STOP_WORDS + HEDGES + META + QUALIFIERS + BUZZWORDS


@dataclass
class Finding:
    line: int
    level: str
    code: str
    message: str
    excerpt: str


def _skip_zones(lines: list[str]) -> set[int]:
    """1-based номера строк вне зоны проверки: frontmatter, fenced-блоки, HTML-комментарии."""
    skip: set[int] = set()

    if lines and lines[0].strip() == "---":
        skip.add(1)
        for zero_idx in range(1, len(lines)):
            line_no = zero_idx + 1
            skip.add(line_no)
            if lines[zero_idx].strip() == "---":
                break

    in_fence = False
    in_comment = False
    for idx, raw in enumerate(lines, start=1):
        stripped = raw.lstrip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            skip.add(idx)
            continue
        if in_fence:
            skip.add(idx)
            continue
        opens = "<!--" in raw
        closes = "-->" in raw
        if in_comment:
            skip.add(idx)
            if closes:
                in_comment = False
            continue
        if opens:
            skip.add(idx)
            if not closes:
                in_comment = True

    return skip


def lint(path: Path) -> list[Finding]:
    text = path.read_text(encoding="utf-8")
    lines = text.split("\n")
    skip = _skip_zones(lines)
    out: list[Finding] = []
    for idx, raw in enumerate(lines, start=1):
        if idx in skip:
            continue
        for pattern in ALL_PATTERNS:
            m = pattern.regex.search(raw)
            if m:
                excerpt = raw.strip()
                if len(excerpt) > 100:
                    excerpt = excerpt[:97] + "..."
                out.append(Finding(idx, "ERROR", pattern.code, pattern.message, excerpt))
    return sorted(out, key=lambda f: (f.line, f.code))


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Лексический линтер БФТ на AI-слоп (writing_style.md §1, §1a)")
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--format", choices=["text", "json"], default="text")
    args = parser.parse_args(argv)

    report: dict[str, list[dict]] = {}
    total = 0
    for path in args.files:
        if not path.is_file():
            print(f"{path}: ERROR IO001 файл не найден", file=sys.stderr)
            return 2
        findings = lint(path)
        report[str(path)] = [asdict(f) for f in findings]
        total += len(findings)
        if args.format == "text":
            for f in findings:
                print(f'{path}:{f.line}: {f.level} {f.code} {f.message} — «{f.excerpt}»')
            if not findings:
                print(f"{path}: OK — слов из anti-slop словаря нет ({len(ALL_PATTERNS)} паттернов проверено)")

    if args.format == "json":
        print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
