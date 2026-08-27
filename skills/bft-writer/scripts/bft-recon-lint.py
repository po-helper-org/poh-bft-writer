#!/usr/bin/env python3
"""bft-recon-lint — линтер карты контекста `context_map.md` (гейт 20).

Карту строит `/bft-recon` — разведчик JIRA/Confluence. Ценность карты держится на
двух правилах, и оба проверяются машинно, а не самоотчётом модели:

  * находка без ключа задачи или URL непроверяема — её быть не должно (`RC003`);
  * раздел «Что не найдено» отделяет «искал и не нашёл» от «не искал» (`RC005`).

Формат карты — `skills/bft-recon/resources/findings_format.md`.

Использование:
    python3 scripts/bft-recon-lint.py <context_map.md> [...]
    python3 scripts/bft-recon-lint.py --format json <context_map.md>

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

FRONTMATTER_KEYS = ["epic_slug", "scanned", "sources", "findings"]

FINDINGS_HEADING = "## Находки"
NOT_FOUND_HEADING = "## Что не найдено"

TABLE_HEADER = ["Тип", "Заголовок", "Ссылка", "Почему релевантно", "Статус/дата"]

FINDING_TYPES = {
    "УЖЕ ОПИСАНО",
    "ПЕРЕСЕЧЕНИЕ",
    "ЗАВИСИМОСТЬ",
    "ПРОТИВОРЕЧИЕ",
    "ВЛАДЕЛЕЦ",
    "ТЕРМИН",
}

# Якорь находки: markdown-ссылка, голый URL или ключ задачи трекера (PROJ-123).
ANCHOR_RE = re.compile(r"\]\(https?://|https?://|\b[A-Z][A-Z0-9]+-\d+\b")


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


def table_rows(lines: list[str], start: int, end: int) -> list[tuple[int, list[str]]]:
    """Строки markdown-таблицы в диапазоне (1-based, включительно)."""
    rows: list[tuple[int, list[str]]] = []
    for idx in range(start, min(end, len(lines)) + 1):
        raw = lines[idx - 1].strip()
        if not (raw.startswith("|") and raw.endswith("|")):
            continue
        rows.append((idx, [c.strip() for c in raw.strip("|").split("|")]))
    return rows


def find_heading(lines: list[str], exact: str) -> int:
    for idx, raw in enumerate(lines, start=1):
        if raw.rstrip() == exact:
            return idx
    return 0


def lint(path: Path) -> list[Finding]:
    lines = path.read_text(encoding="utf-8").split("\n")
    out: list[Finding] = []

    fm, fm_end = parse_frontmatter(lines)
    if not fm_end:
        out.append(Finding(1, "ERROR", "RC001", "нет frontmatter — карта без epic_slug и даты обхода непривязываема"))
    else:
        missing = [k for k in FRONTMATTER_KEYS if k not in fm]
        if missing:
            out.append(Finding(1, "ERROR", "RC001", f"во frontmatter нет ключей: {', '.join(missing)}"))

    findings_line = find_heading(lines, FINDINGS_HEADING)
    not_found_line = find_heading(lines, NOT_FOUND_HEADING)

    if not findings_line:
        out.append(Finding(max(fm_end, 1), "ERROR", "RC002", f"нет раздела «{FINDINGS_HEADING}»"))
    else:
        end = not_found_line - 1 if not_found_line > findings_line else len(lines)
        rows = table_rows(lines, findings_line, end)
        if not rows:
            out.append(Finding(findings_line, "ERROR", "RC002", "под «Находки» нет таблицы"))
        else:
            header_idx, header = rows[0]
            if header != TABLE_HEADER:
                out.append(Finding(header_idx, "ERROR", "RC002", f"колонки таблицы находок: ожидались {' | '.join(TABLE_HEADER)}"))
            for idx, cells in rows[1:]:
                if set("".join(cells)) <= set("-: "):
                    continue  # строка-разделитель markdown
                if len(cells) != len(TABLE_HEADER):
                    out.append(Finding(idx, "ERROR", "RC002", f"в строке находки {len(cells)} колонок вместо {len(TABLE_HEADER)}"))
                    continue
                kind, title, link, why, _ = cells
                if kind not in FINDING_TYPES:
                    out.append(Finding(idx, "ERROR", "RC004", f"тип «{kind}» не из списка: {', '.join(sorted(FINDING_TYPES))}"))
                if not ANCHOR_RE.search(link):
                    out.append(Finding(idx, "ERROR", "RC003", f"находка «{title}» без ключа задачи и без URL — проверить её нельзя, значит это не находка"))
                if not why:
                    out.append(Finding(idx, "ERROR", "RC003", f"находка «{title}»: пустая колонка «Почему релевантно»"))

    if not not_found_line:
        out.append(Finding(len(lines), "ERROR", "RC005", f"нет раздела «{NOT_FOUND_HEADING}» — молчание выдаётся за отсутствие находок"))

    return sorted(out, key=lambda f: (f.line, f.code))


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Линтер карты контекста /bft-recon")
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
            if not findings:
                print(f"{path}: OK — карта следует формату")

    if args.format == "json":
        print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
