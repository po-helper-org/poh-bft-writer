#!/usr/bin/env python3
"""bft-matrix-publish — тело дочерней страницы Confluence для матрицы исполнения.

`/bft-deliver <epic> --matrix` публикует матрицу под страницей БФТ. Командам на странице нужно
то же, что PO видит на странице ревью: сводка исполнения по командам и знак статуса у строки.
Скрипт собирает это тело в markdown (дальше — обычная конвертация ссылок в макросы /bft-deliver):

  * frontmatter и H1 убираются: заголовок страницы задаёт /bft-deliver;
  * под строкой-пояснением — пометка об источнике и сводка (считает `bft_matrix`, как и страница
    ревью — числа у PO и у команд совпадают);
  * статус строки получает знак (✓ ◐ ↩ ⊘ ◔ ○ —);
  * пункты чеклиста `- [ ]`/`- [x]` → `- ☐`/`- ☑`: разметка задач в Confluence стала бы
    задачами с исполнителями, которые никто не синхронизирует с матрицей.

Использование:
    python3 bft-matrix-publish.py <epic-matrix.md>   # тело — в stdout
    python3 bft-matrix-publish.py -                  # матрица из stdin
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import bft_matrix  # noqa: E402

FM_RE = re.compile(r"^---\n(.*?)\n---\n", re.S)


def frontmatter(text: str) -> tuple[dict[str, str], str]:
    m = FM_RE.match(text)
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).split("\n"):
        k, _, v = line.partition(":")
        if _:
            meta[k.strip()] = re.sub(r"\s+#.*$", "", v).strip().strip('"')
    return meta, text[m.end():]


def source_note(meta: dict[str, str]) -> str:
    status = meta.get("status", "")
    lead = ("**Черновик на согласование.** Отметьте согласие своей команды у владельца матрицы. "
            if status == "черновик" else "")
    return (f"> {lead}Страница собрана из матрицы PO: версия {meta.get('version', '?')}, статус «{status}», "
            f"обновлено {meta.get('revised', '?')}, владелец — {meta.get('owner', '?')}. "
            "Статусы строк и согласия меняет владелец матрицы; правки прямо на странице "
            "перезапишутся при следующей отгрузке.")


def summary_md(text: str) -> str:
    lines, total = bft_matrix.summary(bft_matrix.parse(text))
    if not lines:
        return ""
    head = bft_matrix.SUMMARY_HEAD
    out = [f"**Сводка исполнения.** {total}.", "",
           "| " + " | ".join(head) + " |", "| " + " | ".join("---" for _ in head) + " |"]
    out += ["| " + " | ".join(bft_matrix.summary_cells(line)) + " |" for line in lines]
    return "\n".join(out)


def mark_statuses(body: str) -> str:
    """Знак перед статусом в колонке «Статус» таблицы строк матрицы."""
    out, idx = [], None
    for raw in body.split("\n"):
        line = raw.strip()
        if line.startswith("|") and line.endswith("|"):
            cells = [c.strip() for c in line.strip("|").split("|")]
            if idx is None and "Статус" in cells and all(c in cells for c in bft_matrix.TEAM_COLS):
                idx = cells.index("Статус")
            elif idx is not None and not set("".join(cells)) <= set("-: ") and len(cells) > idx:
                kind = bft_matrix.status_kind(cells[idx])
                if kind:
                    cells[idx] = f"{kind[0]} {cells[idx]}"
                    raw = "| " + " | ".join(cells) + " |"
        else:
            idx = None
        out.append(raw)
    return "\n".join(out)


def tasks_to_glyphs(body: str) -> str:
    def glyph(m: re.Match) -> str:
        return f"{m.group(1)}- {'☐' if m.group(2) == ' ' else '☑'} "
    return "\n".join(bft_matrix.TASK_RE.sub(glyph, line) for line in body.split("\n"))


def build(text: str) -> str:
    meta, body = frontmatter(text)
    body = re.sub(r"\A\s*# .*\n", "", body.lstrip("\n"), count=1)
    pos = body.find("\n## ")
    head, rest = (body[:pos], body[pos:]) if pos >= 0 else (body, "")
    parts = [head.strip(), source_note(meta), summary_md(text)]
    body = "\n\n".join(p for p in parts if p) + "\n" + rest
    return tasks_to_glyphs(mark_statuses(body)).strip() + "\n"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Тело страницы Confluence для матрицы исполнения")
    parser.add_argument("path", help="матрица <epic>-matrix.md или «-» для stdin")
    args = parser.parse_args(argv)
    text = sys.stdin.read() if args.path == "-" else Path(args.path).read_text(encoding="utf-8")
    sys.stdout.write(build(text))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
