#!/usr/bin/env python3
"""bft-matrix-lint — линтер матрицы исполнения (гейт 23).

Матрица исполнения (`/bft-matrix`) фиксирует по deep-БФТ, кто, что и где делает на стыках
команд и по каким критериям работа принимается. Документ работает, только пока у каждой
строки однозначный ответ на «сдано ли» — это и проверяется машинно, а не самоотчётом модели:

  * у строки один поставщик с именем и проверяющий из другой команды (`MX003`, `MX004`);
  * критерий отвечает «да/нет» и у него есть доказательство (`MX005`);
  * каждое ФТ/ИТ/НФТ БФТ покрыто нужными командами (`MX007`);
  * возврат записан в журнал с типом и причиной (`MX010`);
  * согласованная матрица не держит открытых дыр, и все команды приняли её версию (`MX013`).

Формат документа — `skills/bft-exec-matrix/resources/document_assembly.md`, правила строки —
`row_rules.md`, коды — `skills/bft-writer/resources/hard_gates.md` §«Гейт 23».

Использование:
    python3 scripts/bft-matrix-lint.py <epic-matrix.md> [...]
    python3 scripts/bft-matrix-lint.py --source <epic.md> <epic-matrix.md>
    python3 scripts/bft-matrix-lint.py --format json <epic-matrix.md>
    python3 scripts/bft-matrix-lint.py --today 2026-10-28 <epic-matrix.md>   # для тестов

Коды выхода: 0 — ошибок нет; 1 — есть ERROR; 2 — файл не прочитан.
Формат вывода: <путь>:<строка>: <УРОВЕНЬ> <КОД> <сообщение>
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import sys
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path

FRONTMATTER_KEYS = ["epic_slug", "stage", "source", "source_rev", "owner", "version",
                    "status", "revised", "next_review"]
DOC_STATUSES = ["черновик", "согласована", "в исполнении", "закрыта"]

# Порядок разделов — порядок чтения: кто участвует → что надо покрыть → кто кому отдаёт →
# строки → паузы → где ошиблись → риски.
SECTIONS = [
    "## Участники",
    "## Покрытие требований",
    "## Карта стыков",
    "## Матрица исполнения",
    "## Чеклисты точек паузы",
    "## Журнал возвратов",
    "## Риски стыков",
]
HEADERS = {
    "## Участники": ["Команда", "Представитель", "Руководитель", "Зрелость", "Режим", "Ритм",
                     "Согласовано"],
    "## Покрытие требований": ["Требование", "Суть", "Команды", "Строки"],
    "## Карта стыков": ["Поставщик", "Потребитель", "Строки", "Ведущая команда"],
    "## Матрица исполнения": ["ID", "Требование", "Поставщик", "Потребитель", "Что", "Где",
                              "Критерий приёмки", "Доказательство", "Проверяет", "Пауза", "Срок",
                              "Статус", "Jira"],
    "## Журнал возвратов": ["№", "Строка", "Дата", "Кто вернул", "Тип", "Что не так",
                            "Корневая причина", "Действие", "Повторная сдача", "Урок"],
    "## Риски стыков": ["Риск", "Строки", "Состояние", "Владелец", "Пересмотр"],
}
# Пустые разделы пишутся строкой, а не пустой таблицей: так видно, что о них не забыли.
EMPTY_OK = {
    "## Журнал возвратов": "Возвратов нет.",
    "## Риски стыков": "Подтверждённых рисков нет.",
}

PAUSES = ["Старт", "Стыковка", "Приёмка", "Запуск", "После запуска"]
MAX_CHECKLIST = 9
MAX_ROWS_PER_PAUSE = 9
STALE_DAYS = 14

MATURITY_MODES = {"A": {"DO-CONFIRM"}, "B": {"DO-CONFIRM", "READ-DO"}, "C": {"READ-DO"}}
RETURN_TYPES = ["Критерий не выполнен", "Не тот результат", "Не то место", "Сорван срок",
                "Неверный критерий", "Стык не учтён"]
ROOT_CAUSES = ["Исполнение", "Матрица", "БФТ", "Коммуникация"]
RISK_STATES = ["Снят", "Взят", "Принят", "Снижен"]

ROW_ID_RE = re.compile(r"^EX-\d{2,}$")
REQ_RE = re.compile(r"^(ФТ|ИТ|НФТ)-\d+$")
SOURCE_REQ_RE = re.compile(r"^\|\s*((?:ФТ|ИТ|НФТ)-\d+)\s*\|", re.M)
DATE = r"\d{2}\.\d{2}\.\d{4}"
STATUS_RES = [
    re.compile(r"^Не начато$"),
    re.compile(r"^В работе$"),
    re.compile(rf"^Сдано {DATE}\b"),
    re.compile(rf"^Принято {DATE}\b"),
    re.compile(r"^Возврат$"),
    re.compile(r"^Заблокировано:\s*\S"),
    re.compile(r"^N/A:\s*\S"),
]
PERSON_RE = re.compile(r"^(?P<team>.+?)\s+—\s+(?P<person>.+)$")
AGREED_RE = re.compile(rf"^версия (\d+), {DATE}$")
CHECK_ITEM_RE = re.compile(r"^- \[[ xX]\] \S")
UTOCH_RE = re.compile(r"\[УТОЧНИТЬ")
PLACEHOLDER = {"", "—", "-"}

# Размытые критерии: каждая сторона стыка прочитает их по-своему — источник возвратов.
VAGUE_RE = re.compile(
    r"корректн|правильн|в полном объ[её]ме|удобн|качественн|своевременн|быстр|надёжн|надежн|"
    r"как договорились|при необходимости|и т\.\s?[дп]\.",
    re.I,
)
# Высота БФТ (гейт 14): технический контракт живёт у СА, в матрице — ссылкой в доказательстве.
ALTITUDE_RE = re.compile(
    r"/api/|\b(?:GET|POST|PUT|PATCH|DELETE)\b\s+/|\bJSON\b|\bREST\b|endpoint|эндпоинт|"
    r"\b[a-z]+_[a-z0-9_]+\b|\bтаблиц[аеуы]\s+[a-z_]+|\bтопик|\bkafka\b|\bSQL\b",
)
MULTI_TEAM_RE = re.compile(r"\bвсе\b|совместно|,|\s/\s", re.I)


@dataclass
class Finding:
    line: int
    level: str  # ERROR | WARN
    code: str
    message: str


@dataclass
class Row:
    line: int
    cells: dict[str, str]

    def __getitem__(self, key: str) -> str:
        return self.cells.get(key, "")


def parse_frontmatter(lines: list[str]) -> tuple[dict[str, str], int]:
    if not lines or lines[0].strip() != "---":
        return {}, 0
    fm: dict[str, str] = {}
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return fm, i + 1
        m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*?)\s*(?:#.*)?$", lines[i])
        if m:
            fm[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return fm, 0


def section_bounds(lines: list[str], start: int) -> int:
    for idx in range(start + 1, len(lines) + 1):
        if lines[idx - 1].startswith("## "):
            return idx - 1
    return len(lines)


def split_row(raw: str) -> list[str]:
    return [c.strip() for c in raw.strip().strip("|").split("|")]


def table(lines: list[str], start: int, end: int) -> tuple[int, list[str], list[tuple[int, list[str]]]]:
    """(строка заголовка, заголовок, строки данных) первой таблицы в диапазоне."""
    header_line, header, rows = 0, [], []
    for idx in range(start, min(end, len(lines)) + 1):
        raw = lines[idx - 1].strip()
        if not (raw.startswith("|") and raw.endswith("|")):
            if header and rows:
                break
            continue
        cells = split_row(raw)
        if set("".join(cells)) <= set("-: "):
            continue
        if not header:
            header_line, header = idx, cells
        else:
            rows.append((idx, cells))
    return header_line, header, rows


def parse_date(text: str) -> dt.date | None:
    for fmt in ("%Y-%m-%d", "%d.%m.%Y"):
        try:
            return dt.datetime.strptime(text.strip(), fmt).date()
        except ValueError:
            pass
    return None


def ids_in(cell: str, pattern: str = r"EX-\d+") -> list[str]:
    return re.findall(pattern, cell)


class Linter:
    def __init__(self, path: Path, source: Path | None, today: dt.date):
        self.path = path
        self.lines = path.read_text(encoding="utf-8").split("\n")
        self.source_override = source
        self.today = today
        self.out: list[Finding] = []
        self.fm: dict[str, str] = {}
        self.sections: dict[str, int] = {}
        self.teams: dict[str, Row] = {}
        self.rows: dict[str, Row] = {}
        self.row_list: list[Row] = []

    def add(self, line: int, level: str, code: str, msg: str) -> None:
        self.out.append(Finding(line, level, code, msg))

    def err(self, line: int, code: str, msg: str) -> None:
        self.add(line, "ERROR", code, msg)

    def warn(self, line: int, code: str, msg: str) -> None:
        self.add(line, "WARN", code, msg)

    @property
    def draft(self) -> bool:
        return self.fm.get("status") == "черновик"

    # ---------- frontmatter ----------

    def check_frontmatter(self) -> None:
        fm, end = parse_frontmatter(self.lines)
        self.fm = fm
        if not end:
            self.err(1, "MX001", "нет frontmatter — матрицу не к чему привязать (epic_slug, source, version)")
            return
        missing = [k for k in FRONTMATTER_KEYS if not fm.get(k)]
        if missing:
            self.err(1, "MX001", "во frontmatter нет ключей: " + ", ".join(missing))
        if fm.get("stage") and fm["stage"] != "matrix":
            self.err(1, "MX001", f"stage: {fm['stage']} — ожидалось stage: matrix")
        if fm.get("status") and fm["status"] not in DOC_STATUSES:
            self.err(1, "MX001", f"status: {fm['status']} — допустимо: {', '.join(DOC_STATUSES)}")
        if fm.get("version") and not fm["version"].isdigit():
            self.err(1, "MX001", f"version: {fm['version']} — целое число")
        if "," in fm.get("owner", "") or " и " in fm.get("owner", ""):
            self.err(1, "MX001", "owner — один человек: у матрицы с двумя владельцами её не ведёт никто")
        for key in ("revised", "next_review"):
            if fm.get(key) and not parse_date(fm[key]):
                self.err(1, "MX001", f"{key}: {fm[key]} — дата ГГГГ-ММ-ДД")

        revised = parse_date(fm.get("revised", ""))
        if fm.get("status") == "в исполнении" and revised and (self.today - revised).days > STALE_DAYS:
            self.warn(1, "MX021", f"матрица в исполнении, а revised {fm['revised']} — больше {STALE_DAYS} дней "
                                  "без обновления: статусы, скорее всего, не отражают исполнение")
        review = parse_date(fm.get("next_review", ""))
        if fm.get("status") in ("согласована", "в исполнении") and review and review < self.today:
            self.warn(1, "MX021", f"ревизия {fm['next_review']} просрочена")

    # ---------- sections ----------

    def check_sections(self) -> None:
        h2 = [(i, raw.rstrip()) for i, raw in enumerate(self.lines, start=1) if raw.startswith("## ")]
        for idx, heading in h2:
            if heading not in SECTIONS:
                self.err(idx, "MX002", f"раздел «{heading[3:]}» вне канона матрицы — лишний раздел "
                                       "дублирует то, что уже есть (версия — во frontmatter, согласие — в «Участниках»)")
            elif heading not in self.sections:
                self.sections[heading] = idx
        for heading in SECTIONS:
            if heading not in self.sections:
                self.err(len(self.lines), "MX002", f"нет раздела «{heading[3:]}»")
        order = [h for h in SECTIONS if h in self.sections]
        if [self.sections[h] for h in order] != sorted(self.sections[h] for h in order):
            self.err(min(self.sections.values(), default=1), "MX002",
                     "разделы не по порядку: " + " → ".join(h[3:] for h in SECTIONS))

    def section_table(self, heading: str) -> list[tuple[int, list[str]]]:
        start = self.sections.get(heading)
        if not start:
            return []
        end = section_bounds(self.lines, start)
        header_line, header, rows = table(self.lines, start, end)
        if not header:
            empty = EMPTY_OK.get(heading)
            body = "\n".join(self.lines[start:end])
            if empty and empty in body:
                return []
            self.err(start, "MX002", f"под «{heading[3:]}» нет таблицы"
                     + (f" и нет строки «{empty}»" if empty else ""))
            return []
        expected = HEADERS[heading]
        if header != expected:
            self.err(header_line, "MX002", f"заголовок таблицы «{heading[3:]}» — ожидалось: "
                     + " | ".join(expected))
            return []
        return rows

    @staticmethod
    def as_rows(raw: list[tuple[int, list[str]]], header: list[str]) -> list[Row]:
        return [Row(line, dict(zip(header, cells + [""] * (len(header) - len(cells))))) for line, cells in raw]

    # ---------- participants ----------

    def check_participants(self) -> None:
        version = self.fm.get("version", "")
        for row in self.as_rows(self.section_table("## Участники"), HEADERS["## Участники"]):
            team = row["Команда"]
            if team in self.teams:
                self.err(row.line, "MX002", f"команда «{team}» указана дважды")
            self.teams[team] = row
            maturity, mode = row["Зрелость"], row["Режим"]
            if maturity not in MATURITY_MODES:
                if not (self.draft and UTOCH_RE.search(maturity)):
                    self.err(row.line, "MX012", f"{team}: зрелость «{maturity}» — A, B или C")
            elif mode not in MATURITY_MODES[maturity] and not (self.draft and UTOCH_RE.search(mode)):
                self.err(row.line, "MX012", f"{team}: зрелость {maturity} и режим «{mode}» — допустимо "
                         + " или ".join(sorted(MATURITY_MODES[maturity]))
                         + " (незрелая команда со сверкой пропускает шаги, зрелая с пошаговым списком перестаёт его читать)")
            agreed = row["Согласовано"]
            if not self.draft:
                m = AGREED_RE.match(agreed)
                if not m:
                    self.err(row.line, "MX013", f"{team}: матрица {self.fm.get('status')}, а команда не отметила "
                             "согласие («версия N, ДД.ММ.ГГГГ»)")
                elif m.group(1) != version:
                    self.err(row.line, "MX013", f"{team}: согласована версия {m.group(1)}, текущая — {version}; "
                             "после изменения стыка команда соглашается заново")
            elif agreed not in PLACEHOLDER and not AGREED_RE.match(agreed):
                self.err(row.line, "MX013", f"{team}: «Согласовано» — «—» или «версия N, ДД.ММ.ГГГГ»")

    # ---------- matrix rows ----------

    def team_of(self, cell: str) -> tuple[str | None, str | None]:
        m = PERSON_RE.match(cell)
        if not m:
            return None, None
        return m.group("team").strip(), m.group("person").strip()

    def check_rows(self) -> None:
        header = HEADERS["## Матрица исполнения"]
        rows = self.as_rows(self.section_table("## Матрица исполнения"), header)
        if not rows and "## Матрица исполнения" in self.sections:
            self.err(self.sections["## Матрица исполнения"], "MX002", "в матрице нет строк")
        per_pause: Counter[tuple[str, str]] = Counter()
        for row in rows:
            rid = row["ID"]
            if not ROW_ID_RE.match(rid):
                self.err(row.line, "MX008", f"ID «{rid}» — формат EX-NN")
            elif rid in self.rows:
                self.err(row.line, "MX008", f"ID {rid} повторяется")
            self.rows[rid] = row
            self.row_list.append(row)
            if not REQ_RE.match(row["Требование"]):
                self.err(row.line, "MX008", f"{rid}: требование «{row['Требование']}» — ID из БФТ (ФТ-N, ИТ-N, НФТ-N)")

            status = row["Статус"]
            na = status.startswith("N/A")
            if not any(r.match(status) for r in STATUS_RES):
                self.err(row.line, "MX009", f"{rid}: статус «{status}» — Не начато, В работе, Сдано ДД.ММ.ГГГГ, "
                         "Принято ДД.ММ.ГГГГ, Возврат, Заблокировано: чем, N/A: причина")
            if row["Пауза"] not in PAUSES:
                self.err(row.line, "MX009", f"{rid}: пауза «{row['Пауза']}» — " + ", ".join(PAUSES))

            # Поставщик: одна команда и один человек.
            supplier = row["Поставщик"]
            s_team, s_person = self.team_of(supplier)
            if s_team is None or MULTI_TEAM_RE.search(s_team):
                self.err(row.line, "MX003", f"{rid}: поставщик «{supplier}» — одна команда и один человек "
                         "(«Команда — Имя Фамилия»); совместная работа делится на строки")
                s_team = None
            elif s_team not in self.teams:
                self.err(row.line, "MX003", f"{rid}: команды «{s_team}» нет в «Участниках»")
                s_team = None
            elif "," in s_person or " и " in s_person:
                self.err(row.line, "MX003", f"{rid}: у поставщика два человека — «{s_person}»")

            consumer = row["Потребитель"]
            if consumer not in self.teams:
                self.err(row.line, "MX004", f"{rid}: потребитель «{consumer}» — команда из «Участников»")
            elif s_team and consumer == s_team:
                self.err(row.line, "MX004", f"{rid}: потребитель совпадает с поставщиком — это не стык")

            verifier = row["Проверяет"]
            v_team, _ = self.team_of(verifier)
            if v_team is None:
                self.err(row.line, "MX004", f"{rid}: проверяющий «{verifier}» — «Команда — Имя Фамилия»")
            elif v_team not in self.teams:
                self.err(row.line, "MX004", f"{rid}: команды проверяющего «{v_team}» нет в «Участниках»")
            elif s_team and v_team == s_team:
                self.err(row.line, "MX004", f"{rid}: проверяющий из команды поставщика — поставщик не принимает сам у себя")

            if not na:
                criterion, evidence = row["Критерий приёмки"], row["Доказательство"]
                if criterion in PLACEHOLDER:
                    self.err(row.line, "MX005", f"{rid}: нет критерия приёмки")
                elif VAGUE_RE.search(criterion):
                    self.err(row.line, "MX005", f"{rid}: размытый критерий «{VAGUE_RE.search(criterion).group(0)}» — "
                             "напиши, что именно увидит проверяющий, чтобы ответ был «да/нет»")
                if evidence in PLACEHOLDER:
                    self.err(row.line, "MX005", f"{rid}: нет доказательства — с чем поставщик придёт сдавать")
                where = row["Где"]
                if not re.match(r"^\S.*\s·\s\S.*$", where):
                    self.err(row.line, "MX006", f"{rid}: «Где» — «Система · среда» (среда «—», если её нет), а не «{where}»")

            tech = ALTITUDE_RE.search(row["Что"] + " " + row["Критерий приёмки"])
            if tech:
                self.err(row.line, "MX011", f"{rid}: системный уровень «{tech.group(0)}» — контракт живёт у СА, "
                         "в матрице — что увидит потребитель (ссылку на проверку контракта — в «Доказательство»)")

            if s_team and row["Пауза"] in PAUSES:
                per_pause[(s_team, row["Пауза"])] += 1

        for (team, pause), n in per_pause.items():
            if n > MAX_ROWS_PER_PAUSE:
                first = next(r.line for r in rows if self.team_of(r["Поставщик"])[0] == team and r["Пауза"] == pause)
                self.warn(first, "MX022", f"{team} на паузе «{pause}»: {n} строк — похоже на задачи Jira, а не на "
                          f"стыки; держим до {MAX_ROWS_PER_PAUSE}")

        if self.fm.get("status") == "закрыта":
            for row in rows:
                if not (row["Статус"].startswith("Принято") or row["Статус"].startswith("N/A")):
                    self.err(row.line, "MX013", f"{row['ID']}: матрица закрыта, а строка в статусе «{row['Статус']}»")

    # ---------- coverage ----------

    def resolve_source(self) -> Path | None:
        if self.source_override:
            return self.source_override
        src = self.fm.get("source")
        if not src:
            return None
        return (self.path.parent / src).resolve()

    def check_coverage(self) -> None:
        start = self.sections.get("## Покрытие требований", 1)
        coverage = self.as_rows(self.section_table("## Покрытие требований"), HEADERS["## Покрытие требований"])
        covered: dict[str, Row] = {}
        for row in coverage:
            covered[row["Требование"]] = row

        source = self.resolve_source()
        source_reqs: list[str] | None = None
        if source is None or not source.is_file():
            self.err(start, "MX007", f"не найден БФТ-источник «{self.fm.get('source', '')}» — без него покрытие не проверить")
        else:
            text = source.read_text(encoding="utf-8")
            sfm, _ = parse_frontmatter(text.split("\n"))
            if sfm.get("stage") != "deep":
                self.err(start, "MX007", f"источник {source.name} — stage: {sfm.get('stage', '?')}, нужен deep: "
                         "по шапке fast инициатива неполна, и трассировка бесполезна")
            source_reqs = list(dict.fromkeys(SOURCE_REQ_RE.findall(text)))
            rev = hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]
            if self.fm.get("source_rev") and self.fm["source_rev"] != rev:
                self.warn(1, "MX023", f"source_rev {self.fm['source_rev']} ≠ {rev}: БФТ изменился после сборки "
                          "матрицы — пересверь покрытие и обнови source_rev")

        if source_reqs is not None:
            for req in source_reqs:
                if req not in covered:
                    self.err(start, "MX007", f"{req} из БФТ не покрыто: нет строки в «Покрытии требований» "
                             "(решили не делать — строка матрицы со статусом «N/A: причина»)")
            for req, row in covered.items():
                if req not in source_reqs:
                    self.err(row.line, "MX007", f"{req} нет в БФТ — покрытие ссылается на несуществующее требование")

        for req, row in covered.items():
            listed = set(ids_in(row["Строки"]))
            actual = {rid for rid, r in self.rows.items() if r["Требование"] == req}
            for rid in sorted(listed - actual):
                self.err(row.line, "MX007", f"{req}: строка {rid} указана, но в матрице такой строки по {req} нет")
            for rid in sorted(actual - listed):
                self.err(row.line, "MX007", f"{req}: строка {rid} закрывает требование, но не указана в «Строках»")
            for team in [t.strip() for t in row["Команды"].split(",") if t.strip()]:
                if team not in self.teams:
                    self.err(row.line, "MX007", f"{req}: команды «{team}» нет в «Участниках»")
                    continue
                if not any(self.team_of(self.rows[rid]["Поставщик"])[0] == team for rid in actual):
                    self.err(row.line, "MX007", f"{req}: команда «{team}» должна закрыть требование, "
                             "но строки-поставщика от неё нет")
        for row in self.row_list:
            req = row["Требование"]
            if REQ_RE.match(req) and req not in covered:
                self.err(row.line, "MX008", f"{row['ID']}: требования {req} нет в «Покрытии требований»")

    # ---------- interface map ----------

    def check_map(self) -> None:
        start = self.sections.get("## Карта стыков", 1)
        mapped: dict[tuple[str, str], Row] = {}
        for row in self.as_rows(self.section_table("## Карта стыков"), HEADERS["## Карта стыков"]):
            mapped[(row["Поставщик"], row["Потребитель"])] = row
        pairs: dict[tuple[str, str], list[str]] = {}
        for row in self.row_list:
            s_team, _ = self.team_of(row["Поставщик"])
            if s_team in self.teams and row["Потребитель"] in self.teams:
                pairs.setdefault((s_team, row["Потребитель"]), []).append(row["ID"])
        for pair, rids in pairs.items():
            if pair not in mapped:
                self.err(start, "MX014", f"стык {pair[0]} → {pair[1]} ({', '.join(rids)}) не отмечен в карте")
            else:
                listed = set(ids_in(mapped[pair]["Строки"]))
                if listed != set(rids):
                    self.err(mapped[pair].line, "MX014", f"стык {pair[0]} → {pair[1]}: в карте "
                             f"{', '.join(sorted(listed)) or '—'}, в матрице {', '.join(sorted(rids))}")
        for pair, row in mapped.items():
            if pair not in pairs:
                self.err(row.line, "MX014", f"стык {pair[0]} → {pair[1]} в карте есть, строк матрицы под ним нет")
            back = (pair[1], pair[0])
            if back in mapped and row["Ведущая команда"] in PLACEHOLDER:
                self.err(row.line, "MX014", f"встречные стыки {pair[0]} ⇄ {pair[1]} без ведущей команды — "
                         "при сдвиге сроков каждая сторона будет ждать другую")

    # ---------- checklists ----------

    def check_checklists(self) -> None:
        start = self.sections.get("## Чеклисты точек паузы")
        if not start:
            return
        end = section_bounds(self.lines, start)
        groups: dict[str, tuple[int, int]] = {}
        current = None
        for idx in range(start + 1, end + 1):
            raw = self.lines[idx - 1].rstrip()
            if raw.startswith("### "):
                current = raw[4:].strip()
                if current not in PAUSES:
                    self.err(idx, "MX015", f"пауза «{current}» — " + ", ".join(PAUSES))
                groups[current] = (idx, 0)
            elif current and CHECK_ITEM_RE.match(raw):
                line, n = groups[current]
                groups[current] = (line, n + 1)
        used = {"Старт"} | {r["Пауза"] for r in self.row_list if r["Пауза"] in PAUSES}
        for pause in PAUSES:
            if pause in used and pause not in groups:
                self.err(start, "MX015", f"нет чеклиста «### {pause}»"
                         + (" — он нужен всегда" if pause == "Старт" else " — строки матрицы на этой паузе есть"))
        for pause, (line, n) in groups.items():
            if n == 0:
                self.err(line, "MX015", f"«{pause}»: нет пунктов формата «- [ ] …»")
            elif n > MAX_CHECKLIST:
                self.err(line, "MX015", f"«{pause}»: {n} пунктов — держим до {MAX_CHECKLIST}, иначе пункты "
                         "отмечают не читая; дробится пауза, а не чеклист")

    # ---------- journal & risks ----------

    def check_journal(self) -> None:
        journal = self.as_rows(self.section_table("## Журнал возвратов"), HEADERS["## Журнал возвратов"])
        returned = {r["Строка"] for r in journal}
        for row in self.row_list:
            if row["Статус"] == "Возврат" and row["ID"] not in returned:
                self.err(row.line, "MX010", f"{row['ID']}: статус «Возврат», а записи в журнале нет — "
                         "без неё не видно, где и почему ошиблись")
        for rec in journal:
            if rec["Строка"] not in self.rows:
                self.err(rec.line, "MX010", f"запись {rec['№']}: строки «{rec['Строка']}» в матрице нет")
            if rec["Тип"] not in RETURN_TYPES:
                self.err(rec.line, "MX010", f"запись {rec['№']}: тип «{rec['Тип']}» — " + ", ".join(RETURN_TYPES))
            if rec["Корневая причина"] not in ROOT_CAUSES:
                self.err(rec.line, "MX010", f"запись {rec['№']}: причина «{rec['Корневая причина']}» — "
                         + ", ".join(ROOT_CAUSES))
            if rec["Урок"] in PLACEHOLDER:
                self.err(rec.line, "MX010", f"запись {rec['№']}: нет урока — правка чеклиста или строки, "
                         "либо «не требуется» с причиной")

    def check_risks(self) -> None:
        for rec in self.as_rows(self.section_table("## Риски стыков"), HEADERS["## Риски стыков"]):
            if rec["Состояние"] not in RISK_STATES:
                self.err(rec.line, "MX016", f"риск «{rec['Риск']}»: состояние «{rec['Состояние']}» — "
                         + ", ".join(RISK_STATES))
            if rec["Владелец"] in PLACEHOLDER:
                self.err(rec.line, "MX016", f"риск «{rec['Риск']}» без владельца")

    # ---------- agreed state ----------

    def check_open_points(self) -> None:
        if self.draft or not self.fm.get("status"):
            return
        _, fm_end = parse_frontmatter(self.lines)
        for idx in range(fm_end + 1, len(self.lines) + 1):
            if UTOCH_RE.search(self.lines[idx - 1]):
                self.err(idx, "MX013", f"[УТОЧНИТЬ] в матрице со статусом «{self.fm['status']}» — "
                         "согласовать открытую дыру нельзя: каждая команда прочитает её по-своему")

    def run(self) -> list[Finding]:
        self.check_frontmatter()
        self.check_sections()
        self.check_participants()
        self.check_rows()
        self.check_coverage()
        self.check_map()
        self.check_checklists()
        self.check_journal()
        self.check_risks()
        self.check_open_points()
        return sorted(self.out, key=lambda f: (f.line, f.code))


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Линтер матрицы исполнения /bft-matrix (гейт 23)")
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--source", type=Path, help="deep-БФТ; по умолчанию — source из frontmatter")
    parser.add_argument("--today", help="дата прогона ГГГГ-ММ-ДД (для тестов свежести)")
    parser.add_argument("--format", choices=["text", "json"], default="text")
    args = parser.parse_args(argv)

    today = parse_date(args.today) if args.today else dt.date.today()
    report: list[dict] = []
    errors = 0
    for path in args.files:
        if not path.is_file():
            print(f"{path}: ERROR IO001 файл не найден", file=sys.stderr)
            return 2
        findings = Linter(path, args.source, today).run()
        errors += sum(1 for f in findings if f.level == "ERROR")
        report += [{"file": str(path), **asdict(f)} for f in findings]
        if args.format == "text":
            for f in findings:
                print(f"{path}:{f.line}: {f.level} {f.code} {f.message}")
            if not any(f.level == "ERROR" for f in findings):
                print(f"{path}: OK — матрица исполнения проходит гейт 23")

    if args.format == "json":
        print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
