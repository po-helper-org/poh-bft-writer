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

# Служебные пометки, адресованные генератору, а не читателю документа.
# `ЗМ-NNN` — id реестра замечаний ревью; в клиентском тексте это внутренний
# идентификатор, по которому читателю некуда пойти (ЗМ-030).
SERVICE_MARK_RE = re.compile(r"\bЗМ-\d+")

# Заметка о состоянии пайплайна в скобках: «(трекер офлайн)», «(MCP недоступен)».
# Легитимная форма пробела — `[УТОЧНИТЬ: MCP недоступен]` в своей ячейке, она
# адресована читателю и остаётся; скобочная нота — след прогона и не остаётся.
PIPELINE_NOTE_RE = re.compile(
    r"\([^()]*\b(?:офлайн|оффлайн|недоступ\w*|не отвеча\w+|UNAVAILABLE|таймаут|"
    r"устарел\w*|не поднят\w*|пропущен\w*)\b[^()]*\)",
    re.IGNORECASE)
UNCLEAR_MARKER = "[УТОЧНИТЬ"

FRONTMATTER_KEYS = [
    "source", "space", "pageId", "version", "synced",
    "jira", "status", "epic_slug", "stage", "pin_commit",
]

HEAD_TITLE = "## Шапка (сутевое описание запроса)"

GOAL_BLOCK = "### Цель"
CRITICAL_BLOCK = "### Критичные требования (скелет на цитатах)"

# Обязательные блоки шапки в фиксированном порядке. Документация — условный.
# «Критичные требования» — только на стадии fast (ЗМ-027): скелет-на-цитатах задаёт
# границы документа, пока канона нет. На deep он развёрнут в разделы канона и снимается.
HEAD_BLOCKS_REQUIRED_COMMON = [
    GOAL_BLOCK,
    "### How to demo",
    "### Ограничения и договоренности",
    "### Общая информация",
]
HEAD_BLOCK_OPTIONAL = "### Документация"

# Блоки, снятые решением PO — их присутствие = ошибка.
HEAD_BLOCKS_FORBIDDEN_COMMON = {
    "### Открытые вопросы": "вопросы живут в «Вводные для разрабатываемого функционала» ниже границы (ЗМ-016)",
    "### Границы": "переименован в «Ограничения и договоренности» (ЗМ-016)",
}
CRITICAL_BLOCK_FORBIDDEN_DEEP = (
    "скелет-на-цитатах развёрнут в разделы канона — на стадии deep блок снимается "
    "вместе со строкой-границей (ЗМ-027)"
)


def head_blocks_required(stage: str) -> list[str]:
    """Состав шапки зависит от стадии: на fast в ней есть «Критичные требования»."""
    if stage != "fast":
        return list(HEAD_BLOCKS_REQUIRED_COMMON)
    out = list(HEAD_BLOCKS_REQUIRED_COMMON)
    out.insert(out.index("### Общая информация"), CRITICAL_BLOCK)
    return out


def head_blocks_forbidden(stage: str) -> dict[str, str]:
    out = dict(HEAD_BLOCKS_FORBIDDEN_COMMON)
    if stage != "fast":
        out[CRITICAL_BLOCK] = CRITICAL_BLOCK_FORBIDDEN_DEEP
    return out


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
    "Заинтересованные стороны": "персоны живут в personas.csv (вложение /bft-fast) и в «Критичных требованиях» шапки fast, не в каноне",
    "История изменений": "снят решением PO",
    "Дополнительные материалы и артефакты": "снят решением PO",
    "Ревью требований": "снят решением PO",
    "Границы": "в каноне отсутствует (ЗМ-014)",
    "Критерии успеха": "в каноне отсутствует (v10)",
    "Ключевые решения": "в каноне отсутствует",
    "Вводные для разрабатываемого функционала": "снят решением PO (ЗМ-020): открытые вопросы живут в письме и в ответе в чате, в документе — [УТОЧНИТЬ] в ячейке требования",
}

CANON_SUBSECTIONS_REQUIRED = [
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
HTML_LIST_RE = re.compile(r"</?(ul|ol|li|br)\s*/?>", re.I)

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
        """Начало области канона. Без границы — первый заголовок канона.

        Заголовки уровня 3 пропускаются: `### Общая информация` и другие блоки шапки
        носят те же имена, что снятые разделы канона, и приняв такой блок за начало
        канона линтер объявил бы шапку каноном (а её обязательные блоки — пропавшими).
        """
        if border:
            return border + 1
        known = set(CANON_SECTIONS) | set(CANON_SECTIONS_FORBIDDEN)
        for idx, title in self.headings(self.fm_end + 1):
            if self.lines[idx - 1].startswith("###"):
                continue
            if title.strip().rstrip("*").strip() in known:
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


def check_border(doc: Doc, out: list[Finding]) -> int:
    """Возвращает номер строки границы (0 — не найдена).

    Граница — служебный якорь стадии fast: по ней /bft-deep отделяет шапку от канона.
    В финальном документе (stage: deep) её быть не должно — документ цельный, зон две
    больше нет, а служебный комментарий в клиентском артефакте лишний (ЗМ-022).
    """
    for idx, raw in enumerate(doc.lines, start=1):
        # Граница — однострочный комментарий, начинающийся с <!--. Упоминание токена
        # в тексте или внутри многострочного комментария границей не считается.
        if BORDER_TOKEN in raw and raw.lstrip().startswith("<!--"):
            doc.border_lines.append(idx)

    if doc.stage == "deep":
        if doc.border_lines:
            out.append(Finding(doc.border_lines[0], "ERROR", "BD003", f"строка-граница {BORDER_TOKEN} осталась в финальном документе — на стадии deep её снимают (ЗМ-022)"))
        return 0

    if not doc.border_lines:
        out.append(Finding(1, "ERROR", "BD001", f"нет строки-границы {BORDER_TOKEN} — шапка и канон неразличимы, следующий /bft-deep не найдёт точку вставки"))
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

    goal_line = doc.find_line(GOAL_BLOCK, head_start, end)
    if not goal_line:
        out.append(Finding(head_start, "ERROR", "HD002", f"в шапке нет блока «{GOAL_BLOCK}» — он несёт образ результата вместо снятого раздела «Бизнес описание»"))
    else:
        smart_ok = False
        for header, rows in doc.tables(goal_line, end):
            labels = [cells[0] for _, cells in rows if cells]
            smart_ok = header == SMART_TABLE_HEADER and labels == SMART_ROWS
            break
        if not smart_ok:
            out.append(Finding(goal_line, "ERROR", "HD007", f"под «{GOAL_BLOCK}» нет SMART-таблицы («{' | '.join(SMART_TABLE_HEADER)}», строки {' → '.join(SMART_ROWS)}) — см. document_assembly.md §SMART-таблица"))
        check_goal_prose(doc, goal_line, end, out)

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

    forbidden = head_blocks_forbidden(doc.stage)
    required = head_blocks_required(doc.stage)

    for idx, raw in seen:
        if raw in forbidden:
            out.append(Finding(idx, "ERROR", "HD003", f"блок «{raw}» снят из шапки: {forbidden[raw]}"))

    titles = [raw for _, raw in seen]
    for block in required:
        if block not in titles:
            out.append(Finding(head_start, "ERROR", "HD004", f"в шапке нет обязательного блока «{block}»"))

    ordered = [t for t in titles if t in required]
    expected = [b for b in required if b in titles]
    if ordered != expected:
        out.append(Finding(head_start, "ERROR", "HD005", f"порядок блоков шапки нарушен: ожидался {' → '.join(expected)}"))

    check_critical_table(doc, head_start, end, out)


def check_goal_prose(doc: Doc, goal_line: int, end: int, out: list[Finding]) -> None:
    """Между «### Цель» и SMART-таблицей текста нет (ЗМ-026).

    Прозаическое пояснение под целью пересказывало то, на что уже отвечает таблица:
    S — что делаем, R — зачем. В письме строка «Цель: …» остаётся (letter_format.md),
    в документе её место занимает таблица.
    """
    for idx in range(goal_line + 1, min(end, len(doc.lines)) + 1):
        if doc.skip(idx):
            continue
        raw = doc.lines[idx - 1].strip()
        if not raw:
            continue
        if raw.startswith("|") or raw.startswith("#"):
            return
        out.append(Finding(idx, "ERROR", "HD008", f"под «{GOAL_BLOCK}» стоит текстовое пояснение — в документе цель несёт только SMART-таблица (ЗМ-026)"))
        return


def check_critical_table(doc: Doc, start: int, end: int, out: list[Finding]) -> None:
    header_line = doc.find_line(CRITICAL_BLOCK, start, end)
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
        # Области канона нет вовсе. На fast это само по себе дефект: плейсхолдер
        # обязателен, и без него документ молча выходит без точки продолжения.
        # Проверку не пропускаем — иначе она глохнет ровно там, где нужна.
        if doc.stage == "fast" and not doc.find_line(PLACEHOLDER_HEADING, doc.fm_end + 1):
            out.append(Finding(len(doc.lines), "ERROR", "CN010", f"на stage: fast нет плейсхолдера «{PLACEHOLDER_HEADING}» — документ без точки продолжения"))
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
                out.append(Finding(idx, "ERROR", "TB002", "HTML-сущности &lt;/&gt; в ячейке — в Confluence отрендерится сырым текстом"))
                break
            if HTML_LIST_RE.search(cell):
                out.append(Finding(idx, "ERROR", "TB003", "HTML-разметка списка (<ul>/<li>/<br>) в ячейке — писать одной короткой формулировкой, без вёрстки (ЗМ-021)"))
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


def check_service_leak(doc: Doc, out: list[Finding]) -> None:
    """Служебные пометки пайплайна, утёкшие в клиентский текст (гейт 1, ЗМ-030).

    Проверяется весь документ, включая шапку: утечка приходит из инструкции
    генератору, а та работает на обеих стадиях. Fenced-блоки и HTML-комментарии
    пропускаются — там живут промт открытого поля и комментарии шаблона.
    """
    for idx, raw in enumerate(doc.lines, start=1):
        if doc.skip(idx):
            continue
        mark = SERVICE_MARK_RE.search(raw)
        if mark:
            out.append(Finding(
                idx, "ERROR", "LK001",
                f"служебная пометка «{mark.group()}» в теле документа — id реестра "
                f"замечаний адресован генератору, читателю по нему идти некуда (ЗМ-030)"))
        note = PIPELINE_NOTE_RE.search(raw)
        if note and UNCLEAR_MARKER not in raw:
            out.append(Finding(
                idx, "ERROR", "LK002",
                f"заметка о состоянии прогона «{note.group()}» в теле документа — "
                f"пробел оформляется как `[УТОЧНИТЬ: …]` в своей ячейке, а не скобкой "
                f"в прозе (ЗМ-030)"))



def check_markup(doc: Doc, out: list[Finding]) -> None:
    """Заголовок, размеченный подчёркиванием (гейт 17, ЗМ-038).

    Канон MTS исторически писался подчёркиванием: строка «Функциональные
    требования*», под ней «====». Форма легальна в markdown, но в этом
    репозитории снята. Причина не в эстетике: подчёркивание не видно в diff как
    заголовок, разъезжается от правки длины строки и уезжает на страницу
    абзацем вместе с «====» в любом рендере, который его не разбирает — ровно
    это и случилось со страницей ревью (ЗМ-037). Заголовок — только «##».

    Fenced-блоки пропускаются: промт открытого поля несёт свой текст, и
    подчёркивание внутри него заголовком документа не является.
    """
    for line_no in range(2, len(doc.lines) + 1):
        underline = doc.lines[line_no - 1].strip()
        if not underline or set(underline) != {"="} or len(underline) < 3:
            continue
        if doc.skip(line_no):
            continue
        title = doc.lines[line_no - 2].strip()
        if not title or title.startswith(("|", ">", "#", "<", "`")):
            continue
        out.append(Finding(
            line_no - 1, "ERROR", "MK001",
            f"заголовок «{title}» размечен подчёркиванием — писать «## {title}»"))



# Базовые адреса корпоративных систем MTS — те же, что в bft_standards.md и в
# bft-deliver-check.py. Меняются здесь, если контур разворачивают в другом.
JIRA_BROWSE = "https://jira.mts.ru/browse/"
WIKI_PAGE = "https://confluence.mts.ru/pages/viewpage.action?pageId="

# Ключ трекера: 2–10 заглавных латинских символов, дефис, номер. ID требований
# БФТ кириллические (БТ-1, ПТ-1, ФТ-1), поэтому не пересекаются.
TRACKER_KEY_RE = re.compile(r"\b([A-Z][A-Z0-9]{1,9})-\d+\b")

# Стандарты и кодировки той же формы, что и ключ трекера. Список — от реальных
# ложных срабатываний на текстах репозитория (UTF-8, RFC-4180); дополняется по
# мере новых, это дешевле, чем требовать заполненный конфиг проектов.
NOT_TRACKER_PREFIX = frozenset({
    "UTF", "ISO", "RFC", "SHA", "MD", "HTTP", "HTTPS", "TLS", "SSL", "AES", "RSA",
    "IPV", "UTC", "GMT", "MSK", "ISBN", "ANSI", "IEEE", "PCI", "DSS", "GOST", "EN",
    "CP", "WIN", "KOI", "BASE", "SLA", "SLO", "API", "CSV", "JSON", "XML", "HTML",
    "CSS", "SQL", "PDF", "PNG", "JPEG", "GIF", "SVG",
})

WIKI_REF_RE = re.compile(r"\bconfluence\s*[:#]?\s*(\d{4,})\b", re.IGNORECASE)
PAGEID_REF_RE = re.compile(r"\bpageid\s*[:=]?\s*(\d{4,})\b", re.IGNORECASE)

MD_LINK_RE = re.compile(r"\[[^\]]*\]\([^)]*\)")
CODE_SPAN_RE = re.compile(r"`[^`]*`")
NO_OBJECT_MARKER_RE = re.compile(r"\[(?:УТОЧНИТЬ|СОЗДАТЬ)[^\]]*\]")


def scannable(line: str) -> str:
    """Строка без того, что ссылкой уже является или ею быть не должно.

    Порядок важен: markdown-ссылка снимается первой — внутри неё и ключ, и URL.
    Дальше уходят код-спаны (там ключ — литерал примера) и пометки
    `[УТОЧНИТЬ …]` / `[СОЗДАТЬ …]`: объекта за ними ещё нет, и ссылка на него
    была бы выдуманной (ЗМ-009).
    """
    for rx in (MD_LINK_RE, CODE_SPAN_RE, NO_OBJECT_MARKER_RE):
        line = rx.sub(" ", line)
    return line


def check_bare_refs(doc: Doc, out: list[Finding]) -> None:
    """Голые ключи JIRA и pageId вики (гейт 10, ЗМ-004/ЗМ-009/ЗМ-012).

    Правило в стандарте было с самого начала — «ни одного голого ключа/pageId в
    готовом документе», — но проверялось только чтением, и голые упоминания
    регулярно доезжали до читателя. Теперь их ловит гейт: линкуется каждое
    вхождение, а не первое.

    Frontmatter пропускается: ключи `jira` и `pageId` там и обязаны быть голыми
    значениями, ссылка в них сломала бы парсинг.
    """
    slug = doc.frontmatter.get("epic_slug", "")
    for idx, raw in enumerate(doc.lines, start=1):
        if idx <= doc.fm_end or doc.skip(idx):
            continue
        text = scannable(raw)
        for m in TRACKER_KEY_RE.finditer(text):
            key = m.group(0)
            # epic_slug сам бывает формы ключа и стоит в H1 — это не упоминание задачи.
            if m.group(1) in NOT_TRACKER_PREFIX or key == slug:
                continue
            out.append(Finding(
                idx, "ERROR", "LN001",
                f"голый ключ трекера «{key}» — оформить ссылкой "
                f"[{key}]({JIRA_BROWSE}{key}); задачи ещё нет — писать [СОЗДАТЬ …] без URL"))
        seen: set[str] = set()
        for rx in (WIKI_REF_RE, PAGEID_REF_RE):
            for m in rx.finditer(text):
                page_id = m.group(1)
                if page_id in seen:
                    continue
                seen.add(page_id)
                out.append(Finding(
                    idx, "ERROR", "LN002",
                    f"голая ссылка на страницу вики «{m.group(0).strip()}» — оформить "
                    f"[Confluence {page_id}]({WIKI_PAGE}{page_id})"))



# Раздел-подвал документа: место, где источникам и положено лежать. Всё, что
# выше него, — тело документа, которое читает бизнес.
SOURCES_SECTION = "Якоря истины"

# Путь к внутреннему файлу: хотя бы один слэш и расширение документа. URL под
# шаблон не попадает — у ссылки перед именем стоит «/» или «.», а они в
# отрицательном ретроспективном условии.
INTERNAL_PATH_RE = re.compile(
    r"(?<![\w/@:.\-])"
    r"((?:[A-Za-zА-Яа-яЁё0-9_.\-]+/)+[A-Za-zА-Яа-яЁё0-9_.\- ]+"
    r"\.(?:md|markdown|txt|docx?|pdf|csv|xlsx?|pptx?|json|ya?ml))")

# OKR среди внутренних путей выделен отдельно: его чинят не переносом вниз, а
# переписыванием в человеческую форму.
OKR_HINT_RE = re.compile(r"(?:^|/)okr/|(?:^|/)kr[-_]?\d+[-_.]\d+", re.IGNORECASE)
OKR_FORMAT = "Q{квартал}{год} KR{N}.{M} команда {команда}, PO {ФИО}"


def check_internal_sources(doc: Doc, out: list[Finding]) -> None:
    """Внутренние источники в теле документа (гейт 10, ЗМ-043/ЗМ-044).

    БФТ читают за пределами команды, и там путь `GROUND/_intake/chats/…md`
    некликабелен и ничего не значит: у читателя нет ни этого репозитория, ни
    прав на него. В теле документа ссылаются только на Confluence и JIRA;
    внутренний источник живёт в подвале — разделе «Якоря истины», где у него
    есть ранг и тип.

    Frontmatter пропускается: ключ `source` там и обязан нести путь. Fenced-блоки
    тоже — в них лежит промт открытого поля, адресованный следующему прогону.
    """
    stop = len(doc.lines)
    for idx, title in doc.headings(doc.fm_end + 1):
        if SOURCES_SECTION.lower() in title.lower():
            stop = idx - 1
            break

    for idx, raw in enumerate(doc.lines, start=1):
        if idx <= doc.fm_end or idx > stop or doc.skip(idx):
            continue
        for m in INTERNAL_PATH_RE.finditer(raw):
            path = m.group(1)
            if OKR_HINT_RE.search(path):
                out.append(Finding(
                    idx, "ERROR", "SR002",
                    f"OKR указан файлом «{path}» — писать текстом «{OKR_FORMAT}»; "
                    f"сам файл, если нужен, идёт в «{SOURCES_SECTION}»"))
            else:
                out.append(Finding(
                    idx, "ERROR", "SR001",
                    f"внутренний источник «{path}» в теле документа — в теле ссылаются "
                    f"только на Confluence и JIRA, внутренний путь идёт в «{SOURCES_SECTION}»"))


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
    check_service_leak(doc, out)
    check_markup(doc, out)
    check_bare_refs(doc, out)
    check_internal_sources(doc, out)
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
