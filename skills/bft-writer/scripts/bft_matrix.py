"""Разбор матрицы исполнения и сводка по командам — один источник для страницы ревью
(`bft-html-export.py`) и для страницы Confluence (`bft-matrix-publish.py`).

Сводка — производное от строк и журнала. В .md её нет: производное в исходнике расходится с
ним при первой правке. Её считают заново при каждой сборке, и считает один этот модуль, иначе
страница ревью и опубликованная страница показали бы командам разные числа.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

TEAM_COLS = ("Поставщик", "Потребитель", "Проверяет")

# Статус строки → знак. Порядок значим: проверяется префикс.
STATUS_GLYPHS = (
    ("Принято", "✓", "accepted"),
    ("Сдано", "◐", "submitted"),
    ("Возврат", "↩", "returned"),
    ("Заблокировано", "⊘", "blocked"),
    ("В работе", "◔", "progress"),
    ("Не начато", "○", "new"),
    ("N/A", "—", "na"),
)


def team_of(cell: str) -> str:
    """«Команда — Имя Фамилия» → «Команда»; без тире ячейка и есть команда."""
    return cell.split(" — ", 1)[0].strip()


def status_kind(cell: str) -> tuple[str, str] | None:
    """(знак, вид) статуса строки или None, если статус не опознан."""
    for prefix, glyph, kind in STATUS_GLYPHS:
        if cell.startswith(prefix):
            return glyph, kind
    return None


@dataclass
class Table:
    header: list[str]
    rows: list[dict[str, str]] = field(default_factory=list)


@dataclass
class Matrix:
    participants: Table | None
    rows: Table | None
    journal: Table | None


@dataclass
class TeamLine:
    team: str
    mode: str
    agreed: str
    total: int
    accepted: int
    submitted: int
    in_progress: int
    blocked: int
    returned_now: int
    returned_all: int


def _split(raw: str) -> list[str]:
    return [c.strip() for c in raw.strip().strip("|").split("|")]


def _tables(text: str) -> list[Table]:
    out: list[Table] = []
    current: Table | None = None
    for raw in text.split("\n"):
        line = raw.strip()
        if not (line.startswith("|") and line.endswith("|")):
            current = None
            continue
        cells = _split(line)
        if set("".join(cells)) <= set("-: "):
            continue
        if current is None:
            current = Table(cells)
            out.append(current)
        else:
            cells += [""] * (len(current.header) - len(cells))
            current.rows.append(dict(zip(current.header, cells)))
    return out


def parse(text: str) -> Matrix:
    tables = _tables(text)

    def find(pred):
        return next((t for t in tables if pred(t.header)), None)

    return Matrix(
        participants=find(lambda h: h[:2] == ["Команда", "Представитель"]),
        rows=find(lambda h: all(c in h for c in TEAM_COLS + ("Статус",))),
        journal=find(lambda h: h[:2] == ["№", "Строка"]),
    )


def summary(m: Matrix) -> tuple[list[TeamLine], str]:
    """Строки сводки по командам-участникам и итоговая строка «Принято N из M · …»."""
    if not m.participants or not m.rows:
        return [], ""
    rows = m.rows.rows
    supplier = {r["ID"]: team_of(r["Поставщик"]) for r in rows}
    returned_all: dict[str, int] = {}
    for rec in (m.journal.rows if m.journal else []):
        team = supplier.get(rec.get("Строка", ""))
        if team:
            returned_all[team] = returned_all.get(team, 0) + 1

    def count(team: str, prefix: str) -> int:
        return sum(1 for r in rows if team_of(r["Поставщик"]) == team and r["Статус"].startswith(prefix))

    lines = []
    for p in m.participants.rows:
        team = p["Команда"]
        lines.append(TeamLine(
            team=team,
            mode=p.get("Режим", ""),
            agreed=p.get("Согласовано", ""),
            total=sum(1 for r in rows if team_of(r["Поставщик"]) == team),
            accepted=count(team, "Принято"),
            submitted=count(team, "Сдано"),
            in_progress=count(team, "В работе") + count(team, "Не начато"),
            blocked=count(team, "Заблокировано"),
            returned_now=count(team, "Возврат"),
            returned_all=returned_all.get(team, 0),
        ))

    statuses = [r["Статус"] for r in rows]
    live = [s for s in statuses if not s.startswith("N/A")]
    na = len(statuses) - len(live)
    total = (f"Принято {sum(1 for s in live if s.startswith('Принято'))} из {len(live)}"
             + (f" · N/A {na}" if na else "")
             + f" · возвратов сейчас {sum(1 for s in live if s.startswith('Возврат'))}"
             + f", всего {len(m.journal.rows) if m.journal else 0}"
             + f" · заблокировано {sum(1 for s in live if s.startswith('Заблокировано'))}")
    return lines, total


SUMMARY_HEAD = ["Команда", "Режим", "Строк", "✓ Принято", "◐ Сдано", "◔ В работе", "⊘ Заблокировано",
                "↩ Возвраты сейчас / всего", "Согласовано"]


def summary_cells(line: TeamLine) -> list[str]:
    """Ячейки строки сводки как текст — порядок совпадает с SUMMARY_HEAD."""
    return [line.team, line.mode, str(line.total), str(line.accepted), str(line.submitted),
            str(line.in_progress), str(line.blocked), f"{line.returned_now} / {line.returned_all}",
            line.agreed]


TASK_RE = re.compile(r"^(\s*)- \[([ xX])\]\s+")
