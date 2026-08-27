#!/usr/bin/env python3
"""bft-lint — структурный линтер документа БФТ.

Проверяет, что документ следует шаблону единого документа
(`skills/bft-fast/resources/document_assembly.md` + канон
`skills/bft-writer/resources/bft_standards.md`). Гейты структуры машинные:
LLM их не «почти соблюдает», линтер даёт бинарный ответ.

Использование:
    python3 scripts/bft-lint.py <файл.md> [<файл.md> ...]
    python3 scripts/bft-lint.py --format json <файл.md>

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

# --- Контракт документа (единственный источник правды для линтера) ----------

FRONTMATTER_KEYS = [
    "source", "space", "pageId", "version", "synced",
    "jira", "status", "epic_slug", "stage", "pin_commit",
]

HEAD_TITLE = "## Шапка (сутевое описание запроса)"

# Обязательные блоки шапки в фиксированном порядке. Документация — условный.
HEAD_BLOCKS_REQUIRED = [
    "### How to demo",
    "### Ограничения и договоренности",
    "### Критичные требования (скелет на цитатах)",
    "### Общая информация",
]
HEAD_BLOCK_OPTIONAL = "### Документация"

# Блоки, снятые решением PO 20.08.2026 (ЗМ-016) — их присутствие = ошибка.
HEAD_BLOCKS_FORBIDDEN = {
    "### Открытые вопросы": "вопросы живут в «Вводные для разрабатываемого функционала» ниже границы",
    "### Границы": "переименован в «Ограничения и договоренности»",
}

BORDER_TOKEN = "BFT-HEAD-END"

# Канон MTS после урезания (ЗМ-016). Порядок фиксирован.
CANON_SECTIONS = [
    "Проблема которую решаем",
    "Изменение в UJM",
    "План демонстрации",
    "Бизнес-Требования",
    "Пользовательские требования*",
    "Требования к интерфейсам*",
    "Функциональные требования*",
    "Нефункциональные требования*",
    "Зависимости",
    "Риски",
    "Якоря истины",
]

# Разделы, удалённые из канона: генерация их больше не производит.
CANON_SECTIONS_FORBIDDEN = {
    "Бизнес описание": "смысл перенесён в блок «Цель» шапки",
    "Общая информация": "перенесена в шапку как «### Общая информация»",
    "Заинтересованные стороны": "персоны живут в «Критичные требования» шапки",
    "История изменений": "снят решением PO",
    "Дополнительные материалы и артефакты": "снят решением PO",
    "Ревью требований": "снят решением PO",
    "Границы": "в каноне отсутствует (ЗМ-014)",
    "Критерии успеха": "в каноне отсутствует (v10)",
    "Ключевые решения": "в каноне отсутствует, вопросы — во «Вводных»",
}

CANON_SUBSECTIONS_REQUIRED = [
    "## Вводные для разрабатываемого функционала*",
    "## Ценность разрабатываемого функционала для бизнес-заказчиков*",
]

PLACEHOLDER_HEADING = "## ⏳ Полный БФТ — в проработке"
CONTINUE_HEADING = "## Продолжить / уточнить БФТ"

CRITICAL_TABLE_HEADER = ["ID", "ASIS (сейчас)", "TOBE (после)", "Связанные", "Источник (цитата)"]
PERSONAS_TABLE_HEADER = ["ФИО", "Роль", "Влияние"]
SMART_TABLE_HEADER = ["SMART", "Значение"]
SMART_ROWS = ["S (Specific)", "M (Measurable)", "A (Achievable)", "R (Relevant)", "T (Time-bound)"]

ID_RE = re.compile(r"^(БТ|ПТ|ИТ|ФТ|НФТ)-[1-9]\d*$")
PRIORITY_VALUES = {"Высокий", "Средний", "Низкий"}
UNCLEAR_RE = re.compile(r"\[УТОЧНИТЬ")

# Эмодзи-маркеры стадии, санкционированные вне канона (гейт 13).
STAGE_MARKERS = "⚡⏳▶✅"
EMOJI_RE = re.compile(
    "[\U0001F300-\U0001FAFF☀-➿⬀-⯿️]"
)


@dataclass
class Finding:
    line: int
    level: str  # ERROR | WARN
    code: str
    message: str


class Doc:
    """Разобранный документ: фронтматтер, границы зон, заголовки, таблицы."""

    def __init__(self, path: Path, text: str):
        self.path = path
        self.lines = text.split("\n")
        self.frontmatter: dict[str, str] = {}
        self.fm_order: list[str] = []
        self.fm_end = 0
        self.border_lines: list[int] = []
        self.fenced: set[int] = set()  # 1-based номера строк внутри ``` блоков
        self.commented: set[int] = set()  # 1-based номера строк внутри <!-- -->
        self._parse_frontmatter()
        self._parse_fences()
        self._parse_comments()

    # -- разбор -------------------------------------------------------------

    def _parse_frontmatter(self) -> None:
        if not self.lines or self.lines[0].strip() != "---":
            return
        for i in range(1, len(self.lines)):
            if self.lines[i].strip() == "---":
                self.fm_end = i + 1  # 1-based номер закрывающей ---
                break
            m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", self.lines[i])
            if m:
                key, value = m.group(1), m.group(2).strip()
                self.frontmatter[key] = value.strip('"').strip("'")
                self.fm_order.append(key)

    def _parse_fences(self) -> None:
        in_fence = False
        for idx, raw in enumerate(self.lines, start=1):
            if raw.lstrip().startswith("```"):
                in_fence = not in_fence
                self.fenced.add(idx)
                continue
            if in_fence:
                self.fenced.add(idx)

    def _parse_comments(self) -> None:
        """Строки внутри HTML-комментариев. Комментарий — не содержимое документа:
        упомянутый там токен BFT-HEAD-END не граница, а заголовок не раздел."""
        in_comment = False
        for idx, raw in enumerate(self.lines, start=1):
            opens = "<!--" in raw
            closes = "-->" in raw
            if in_comment:
                self.commented.add(idx)
                if closes:
                    in_comment = False
                continue
            if opens:
                self.commented.add(idx)
                if not closes:
                    in_comment = True

    def skip(self, idx: int) -> bool:
        return idx in self.fenced or idx in self.commented

    # -- доступ -------------------------------------------------------------

    @property
    def stage(self) -> str:
        return self.frontmatter.get("stage", "")

    def find_line(self, exact: str, start: int = 1, end: int | None = None) -> int:
        """1-based номер строки, равной exact (без учёта хвостовых пробелов)."""
        end = end if end is not None else len(self.lines)
        for idx in range(start, min(end, len(self.lines)) + 1):
            if self.skip(idx):
                continue
            if self.lines[idx - 1].rstrip() == exact:
                return idx
        return 0

    def headings(self, start: int = 1, end: int | None = None) -> list[tuple[int, str]]:
        """ATX- и Setext-заголовки в диапазоне. Возвращает (строка, текст)."""
        end = end if end is not None else len(self.lines)
        out: list[tuple[int, str]] = []
        for idx in range(start, min(end, len(self.lines)) + 1):
            if self.skip(idx):
                continue
            raw = self.lines[idx - 1]
            m = re.match(r"^(#{1,6})\s+(.*)$", raw)
            if m:
                out.append((idx, m.group(2).strip()))
                continue
            # Setext: непустая строка, под ней === или ---
            if idx < len(self.lines) and raw.strip() and not raw.startswith(("|", ">", "-", "*", "#")):
                under = self.lines[idx].strip()
                if len(under) >= 3 and set(under) in ({"="}, {"-"}):
                    out.append((idx, raw.strip()))
        return out

    def table_rows(self, start: int, end: int) -> list[tuple[int, list[str]]]:
        """Строки markdown-таблиц в диапазоне: (номер строки, ячейки)."""
        rows: list[tuple[int, list[str]]] = []
        for idx in range(start, min(end, len(self.lines)) + 1):
            if self.skip(idx):
                continue
            raw = self.lines[idx - 1].strip()
            if not raw.startswith("|") or not raw.endswith("|"):
                continue
            cells = [c.strip() for c in raw.strip("|").split("|")]
            rows.append((idx, cells))
        return rows

    def tables(self, start: int, end: int) -> list[tuple[list[str], list[tuple[int, list[str]]]]]:
        """Таблицы диапазона отдельными блоками: (заголовок, строки-данные).

        Блок рвётся на первой не-табличной строке — иначе соседние таблицы
        склеиваются, и правила одной таблицы применяются к строкам другой.
        """
        blocks: list[tuple[list[str], list[tuple[int, list[str]]]]] = []
        header: list[str] | None = None
        body: list[tuple[int, list[str]]] = []
        for idx in range(start, min(end, len(self.lines)) + 1):
            if self.skip(idx):
                continue
            raw = self.lines[idx - 1].strip()
            is_row = raw.startswith("|") and raw.endswith("|")
            if not is_row:
                if header is not None:
                    blocks.append((header, body))
                    header, body = None, []
                continue
            cells = [c.strip() for c in raw.strip("|").split("|")]
            if header is None:
                header = cells
                continue
            if all(set(c) <= {"-", ":", " "} and c for c in cells):
                continue  # строка-разделитель
            body.append((idx, cells))
        if header is not None:
            blocks.append((header, body))
        return blocks

    def canon_start(self, border: int) -> int:
        """Начало области канона. Без границы — первый заголовок канона."""
        if border:
            return border + 1
        for idx, title in self.headings(self.fm_end + 1):
            if title.strip().rstrip("*").strip() in set(CANON_SECTIONS) | set(CANON_SECTIONS_FORBIDDEN):
                return idx
        return len(self.lines) + 1


# --- Проверки ---------------------------------------------------------------


def check_frontmatter(doc: Doc, out: list[Finding]) -> None:
    if not doc.fm_end:
        out.append(Finding(1, "ERROR", "FM001", "нет frontmatter — документ должен открываться блоком ---"))
        return
    missing = [k for k in FRONTMATTER_KEYS if k not in doc.frontmatter]
    if missing:
        out.append(Finding(1, "ERROR", "FM002", f"нет ключей frontmatter: {', '.join(missing)}"))
    present = [k for k in doc.fm_order if k in FRONTMATTER_KEYS]
    expected = [k for k in FRONTMATTER_KEYS if k in doc.frontmatter]
    if present != expected:
        out.append(Finding(1, "WARN", "FM003", f"порядок ключей frontmatter не канонический: ожидался {', '.join(expected)}"))
    stage = doc.stage
    if stage not in ("fast", "deep"):
        out.append(Finding(1, "ERROR", "FM004", f"stage должен быть fast или deep, получено «{stage}»"))


def check_title(doc: Doc, out: list[Finding]) -> None:
    h1_line = 0
    for idx in range(doc.fm_end + 1, len(doc.lines) + 1):
        if doc.lines[idx - 1].startswith("# "):
            h1_line = idx
            break
    if not h1_line:
        out.append(Finding(doc.fm_end + 1, "ERROR", "H1001", "нет H1 вида «# [БФТ] <epic_slug>: <Название>»"))
        return
    m = re.match(r"^# \[БФТ\] ([\w-]+): .+$", doc.lines[h1_line - 1])
    if not m:
        out.append(Finding(h1_line, "ERROR", "H1002", "H1 не по шаблону «# [БФТ] <epic_slug>: <Название>»"))
        return
    slug = doc.frontmatter.get("epic_slug", "")
    if slug and m.group(1) != slug:
        out.append(Finding(h1_line, "ERROR", "H1003", f"epic_slug в H1 («{m.group(1)}») не совпадает с frontmatter («{slug}»)"))
    nxt = doc.lines[h1_line] if h1_line < len(doc.lines) else ""
    following = nxt.strip() or (doc.lines[h1_line + 1].strip() if h1_line + 1 < len(doc.lines) else "")
    if not following.startswith("> Статус проработки:"):
        out.append(Finding(h1_line + 1, "ERROR", "H1004", "под H1 нет строки-статуса «> Статус проработки: …»"))


def check_border(doc: Doc, out: list[Finding]) -> int:
    """Возвращает номер строки границы (0 — не найдена)."""
    for idx, raw in enumerate(doc.lines, start=1):
        # Граница — однострочный комментарий, начинающийся с <!--. Упоминание токена
        # в тексте или внутри многострочного комментария границей не считается.
        if BORDER_TOKEN in raw and raw.lstrip().startswith("<!--"):
            doc.border_lines.append(idx)
    if not doc.border_lines:
        out.append(Finding(1, "ERROR", "BD001", f"нет строки-границы {BORDER_TOKEN} — шапка и канон неразличимы, следующий /bft-deep допишет второй канон"))
        return 0
    if len(doc.border_lines) > 1:
        out.append(Finding(doc.border_lines[1], "ERROR", "BD002", f"строк-границ {BORDER_TOKEN} больше одной ({len(doc.border_lines)}) — их должно быть ровно одна"))
    return doc.border_lines[0]


def check_head(doc: Doc, border: int, out: list[Finding]) -> None:
    head_start = doc.find_line(HEAD_TITLE)
    if not head_start:
        out.append(Finding(doc.fm_end + 1, "ERROR", "HD001", f"нет заголовка шапки «{HEAD_TITLE}»"))
        return
    end = doc.canon_start(border) - 1

    goal = [idx for idx in range(head_start, end + 1)
            if doc.lines[idx - 1].startswith("Цель:") and not doc.skip(idx)]
    if not goal:
        out.append(Finding(head_start, "ERROR", "HD002", "в шапке нет абзаца «Цель: …» — он несёт образ результата вместо снятого раздела «Бизнес описание»"))
    else:
        smart_ok = False
        for header, rows in doc.tables(goal[0], end):
            labels = [cells[0] for _, cells in rows if cells]
            smart_ok = header == SMART_TABLE_HEADER and labels == SMART_ROWS
            break
        if not smart_ok:
            out.append(Finding(goal[0], "ERROR", "HD007", f"под «Цель:» нет SMART-таблицы («{' | '.join(SMART_TABLE_HEADER)}», строки {' → '.join(SMART_ROWS)}) — см. document_assembly.md §SMART-таблица"))

    seen: list[tuple[int, str]] = []
    for idx in range(head_start, end + 1):
        if doc.skip(idx):
            continue
        raw = doc.lines[idx - 1].rstrip()
        if not raw.startswith("###"):
            continue
        if re.fullmatch(r"###\s*\\?", raw):
            out.append(Finding(idx, "ERROR", "HD006", "битый заголовок: «###» без текста"))
            continue
        seen.append((idx, raw))

    for idx, raw in seen:
        if raw in HEAD_BLOCKS_FORBIDDEN:
            out.append(Finding(idx, "ERROR", "HD003", f"блок «{raw}» снят из шапки: {HEAD_BLOCKS_FORBIDDEN[raw]}"))

    titles = [raw for _, raw in seen]
    for block in HEAD_BLOCKS_REQUIRED:
        if block not in titles:
            out.append(Finding(head_start, "ERROR", "HD004", f"в шапке нет обязательного блока «{block}»"))

    ordered = [t for t in titles if t in HEAD_BLOCKS_REQUIRED]
    expected = [b for b in HEAD_BLOCKS_REQUIRED if b in titles]
    if ordered != expected:
        out.append(Finding(head_start, "ERROR", "HD005", f"порядок блоков шапки нарушен: ожидался {' → '.join(expected)}"))

    check_critical_table(doc, head_start, end, out)


def check_critical_table(doc: Doc, start: int, end: int, out: list[Finding]) -> None:
    header_line = doc.find_line("### Критичные требования (скелет на цитатах)", start, end)
    if not header_line:
        return
    blocks = doc.tables(header_line, end)
    if not blocks:
        out.append(Finding(header_line, "ERROR", "CT001", "под «Критичные требования» нет таблиц (нужны персоны + требования)"))
        return

    personas = [b for b in blocks if b[0] == PERSONAS_TABLE_HEADER]
    requirements = [b for b in blocks if b[0] == CRITICAL_TABLE_HEADER]

    if not personas:
        out.append(Finding(header_line, "ERROR", "CT002", f"нет таблицы персон ({' | '.join(PERSONAS_TABLE_HEADER)})"))
    if not requirements:
        out.append(Finding(header_line, "ERROR", "CT003", f"нет таблицы требований с колонками {' | '.join(CRITICAL_TABLE_HEADER)}"))
        return

    src_idx = len(CRITICAL_TABLE_HEADER) - 1
    for _, rows in requirements:
        for idx, cells in rows:
            if all(not c for c in cells):
                continue  # пустая строка-заглушка — её ловит TB001, не дублируем
            if len(cells) != len(CRITICAL_TABLE_HEADER):
                out.append(Finding(idx, "ERROR", "CT004", f"в таблице требований {len(cells)} колонок вместо {len(CRITICAL_TABLE_HEADER)}"))
                continue
            rid = cells[0]
            if not ID_RE.match(rid):
                out.append(Finding(idx, "ERROR", "CT005", f"идентификатор «{rid}» не по схеме {{БТ|ПТ|ИТ|ФТ|НФТ}}-N без ведущих нулей"))
                continue
            if not cells[src_idx]:
                out.append(Finding(idx, "ERROR", "CT006", f"строка {rid}: пустая колонка «Источник (цитата)» — нет цитаты, нет требования"))


def check_canon(doc: Doc, border: int, out: list[Finding]) -> None:
    start = doc.canon_start(border)
    if start > len(doc.lines):
        return
    heads = doc.headings(start)
    titles = [(idx, t.lstrip("#").strip()) for idx, t in heads]

    for idx, title in titles:
        clean = title.rstrip("*").strip()
        if clean in CANON_SECTIONS_FORBIDDEN:
            out.append(Finding(idx, "ERROR", "CN001", f"раздел «{clean}» удалён из канона: {CANON_SECTIONS_FORBIDDEN[clean]}"))

    if doc.stage == "fast":
        if not doc.find_line(PLACEHOLDER_HEADING, start):
            out.append(Finding(start, "ERROR", "CN010", f"на stage: fast ниже границы нет плейсхолдера «{PLACEHOLDER_HEADING}»"))
        if not any("Вводные для разрабатываемого функционала" in t for _, t in titles):
            out.append(Finding(start, "ERROR", "CN011", "на stage: fast ниже границы нет таблицы «Вводные для разрабатываемого функционала*» — открытым вопросам письма некуда лечь"))
        return

    # stage: deep — полный канон
    present = [t for _, t in titles]
    positions: dict[str, int] = {}
    for idx, title in titles:
        key = title.strip()
        if key in CANON_SECTIONS and key not in positions:
            positions[key] = idx

    missing = [s for s in CANON_SECTIONS if s not in positions]
    if missing:
        out.append(Finding(start, "ERROR", "CN002", f"в каноне нет обязательных разделов: {', '.join(missing)}"))

    ordered = [s for s in CANON_SECTIONS if s in positions]
    if ordered != sorted(ordered, key=lambda s: positions[s]):
        out.append(Finding(start, "ERROR", "CN003", f"порядок разделов канона нарушен: ожидался {' → '.join(CANON_SECTIONS)}"))

    for sub in CANON_SUBSECTIONS_REQUIRED:
        text = sub.lstrip("#").strip()
        if not any(t.strip() == text for t in present):
            out.append(Finding(start, "ERROR", "CN004", f"нет обязательного подраздела «{sub}»"))

    if doc.find_line(PLACEHOLDER_HEADING, start):
        out.append(Finding(doc.find_line(PLACEHOLDER_HEADING, start), "ERROR", "CN005", "на stage: deep остался плейсхолдер «⏳ Полный БФТ — в проработке» — канон не встал на его место"))

    if not doc.find_line(CONTINUE_HEADING, start):
        out.append(Finding(len(doc.lines), "ERROR", "CN006", f"в конце документа нет блока «{CONTINUE_HEADING}» — документ без пути восстановления"))


def check_demo_plan(doc: Doc, border: int, out: list[Finding]) -> None:
    if doc.stage != "deep":
        return
    start = 0
    for idx, title in doc.headings(doc.canon_start(border)):
        if title.strip() == "План демонстрации":
            start = idx
            break
    if not start:
        return
    end = len(doc.lines)
    for idx, title in doc.headings(start + 1):
        if title.strip() in CANON_SECTIONS and idx > start:
            end = idx
            break

    fence_open = 0
    lang = ""
    body: list[str] = []
    found = False
    for idx in range(start, end + 1):
        raw = doc.lines[idx - 1].lstrip()
        if raw.startswith("```"):
            if not fence_open:
                fence_open = idx
                lang = raw[3:].strip()
                body = []
            else:
                found = True
                content = "\n".join(body).strip()
                if not content:
                    out.append(Finding(fence_open, "ERROR", "DP001", f"блок сценария приёмки пуст (```{lang or 'без языка'}) — сценарий не сгенерирован"))
                elif lang != "plantuml":
                    out.append(Finding(fence_open, "ERROR", "DP002", f"язык блока сценария «{lang or 'не указан'}», должен быть plantuml"))
                elif "alt " not in content and "alt\n" not in content:
                    out.append(Finding(fence_open, "ERROR", "DP003", "в PlantUML-сценарии нет ветки alt (negative flow)"))
                fence_open = 0
        elif fence_open:
            body.append(doc.lines[idx - 1])

    if not found:
        out.append(Finding(start, "ERROR", "DP004", "в «Плане демонстрации» нет блока сценария приёмки"))
    if not any("Актор" in " ".join(cells) for _, cells in doc.table_rows(start, end)):
        out.append(Finding(start, "ERROR", "DP005", "в «Плане демонстрации» нет таблицы акторов"))


def check_tables_hygiene(doc: Doc, out: list[Finding]) -> None:
    for idx, cells in doc.table_rows(1, len(doc.lines)):
        if all(not c for c in cells):
            out.append(Finding(idx, "ERROR", "TB001", "полностью пустая строка таблицы — строка-заглушка не выпускается в документ"))
            continue
        for cell in cells:
            if "&lt;" in cell or "&gt;" in cell:
                out.append(Finding(idx, "ERROR", "TB002", "HTML-сущности &lt;/&gt; в ячейке вместо тегов <ul><li> — в Confluence отрендерится сырым текстом (ЗМ-011)"))
                break


def check_priorities(doc: Doc, border: int, out: list[Finding]) -> None:
    if doc.stage != "deep":
        return
    start = 0
    for idx, title in doc.headings(doc.canon_start(border)):
        if title.strip() == "Функциональные требования*":
            start = idx
            break
    if not start:
        return
    end = len(doc.lines)
    for idx, title in doc.headings(start + 1):
        if title.strip() in CANON_SECTIONS and idx > start:
            end = idx
            break
    for idx, cells in doc.table_rows(start, end):
        if len(cells) < 3 or not ID_RE.match(cells[0]):
            continue
        prio = cells[2]
        # «Средний (предварительно)» — законная форма: значение задано, уверенность помечена.
        if UNCLEAR_RE.search(prio) or any(prio.startswith(v) for v in PRIORITY_VALUES):
            continue
        out.append(Finding(idx, "ERROR", "FT001", f"{cells[0]}: приоритет «{prio or 'пусто'}» — нужен Высокий/Средний/Низкий или [УТОЧНИТЬ]"))


def check_emoji_in_canon(doc: Doc, border: int, out: list[Finding]) -> None:
    start = doc.canon_start(border)
    continue_line = doc.find_line(CONTINUE_HEADING, start) or len(doc.lines) + 1
    for idx in range(start, min(continue_line, len(doc.lines) + 1)):
        raw = doc.lines[idx - 1]
        if doc.skip(idx) or raw.lstrip().startswith("<summary>") or PLACEHOLDER_HEADING in raw:
            continue
        for ch in EMOJI_RE.findall(raw):
            if ch in STAGE_MARKERS:
                continue
            out.append(Finding(idx, "ERROR", "ST001", f"эмодзи «{ch}» в каноне (гейт 13)"))
            break


# --- Прогон -----------------------------------------------------------------


def lint(path: Path) -> list[Finding]:
    text = path.read_text(encoding="utf-8")
    doc = Doc(path, text)
    out: list[Finding] = []
    check_frontmatter(doc, out)
    check_title(doc, out)
    border = check_border(doc, out)
    check_head(doc, border, out)
    check_canon(doc, border, out)
    check_demo_plan(doc, border, out)
    check_priorities(doc, border, out)
    check_tables_hygiene(doc, out)
    check_emoji_in_canon(doc, border, out)
    return sorted(out, key=lambda f: (f.line, f.code))


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Структурный линтер документа БФТ")
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
                print(f"{path}: OK — документ следует шаблону")

    if args.format == "json":
        print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
