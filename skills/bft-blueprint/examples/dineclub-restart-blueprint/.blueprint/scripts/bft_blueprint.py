#!/usr/bin/env python3
"""Общий разбор `<epic_slug>-blueprint.md` — модель, которую читают линтер и рендерер.

Документ blueprint — набор markdown-таблиц (формат БФТ: ревьюится глазами, публикуется в
Confluence как есть). Здесь они превращаются в модель: стадии, дорожки, карточки, связи.
Структурные дефекты собираются в `Blueprint.issues` и не бросают исключений: линтер
печатает их все разом, рендерер отказывается рисовать при ошибках.

Только стандартная библиотека.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path

LAYERS = ("выгода", "действия", "контакт", "витрина", "сервис", "основа")
FIXED_LAYERS = ("выгода", "действия", "контакт", "витрина")  # одна дорожка на слой
LANE_LAYERS = ("сервис", "основа")  # дорожек может быть несколько — по системе/команде
LAYER_TITLE = {
    "выгода": "Выгода клиента",
    "действия": "Действия клиента",
    "контакт": "Точки контакта",
    "витрина": "Витрина",
    "сервис": "Сервисы",
    "основа": "Основа и поддержка",
}
# Слои, где карточка обязана нести статус работы: клиентские слои ничего не «реализуются».
BUILD_LAYERS = ("витрина", "сервис", "основа")
KINDS = ("создать", "доработать", "используем", "уточнить")
LINK_TYPES = ("поток", "вызов", "данные")

REQUIRED_FRONTMATTER = (
    "epic_slug", "stage", "source_doc", "source_stage", "source_rev", "version", "revised", "status",
)
IMAGE_FIELDS = ("Выгода на витрине", "Кто получает", "Где видна")

# Порядок фиксирован: он же порядок чтения диаграммы сверху вниз.
SECTIONS = ("Образ результата", "Стадии", "Дорожки", "Карточки", "Связи")
HEADERS = {
    "Образ результата": ("Поле", "Значение"),
    "Стадии": ("ID", "Стадия", "Из сценария"),
    "Дорожки": ("ID", "Слой", "Название", "Команда / система"),
    "Карточки": ("ID", "Слой", "Дорожка", "Стадия", "Что должно работать", "Требования", "Статус"),
    "Связи": ("Откуда", "Куда", "Тип"),
}

REQ_RE = re.compile(r"(?<![А-Яа-яЁё])(?:НФТ|БТ|ПТ|ИТ|ФТ)-\d+")
MARKER = "[УТОЧНИТЬ"
EMPTY = {"", "—", "-", "–"}

# Латинские двойники кириллических букв в ID: «C1» вместо «С1» не должно ломать связь.
_LOOKALIKE = str.maketrans({"C": "С", "K": "К", "c": "С", "k": "К", "с": "С", "к": "К"})
STAGE_RE = re.compile(r"^С-?(\d+)$")
CARD_RE = re.compile(r"^К-?(\d+)$")


@dataclass
class Issue:
    line: int
    level: str  # ERROR | WARN
    code: str
    msg: str
    path: str = ""  # файл, если не основной документ (например, screens/F3.md)


@dataclass
class Stage:
    id: str
    name: str
    scenario: str
    line: int


@dataclass
class Lane:
    id: str
    layer: str
    name: str
    owner: str
    line: int


@dataclass
class Card:
    id: str
    layer: str
    lane: str  # id дорожки; у фиксированных слоёв — сам слой
    stage: str
    text: str
    reqs: list[str]
    kind: str  # из KINDS либо ""
    line: int

    @property
    def has_gap(self) -> bool:
        return MARKER in self.text or self.kind == "уточнить"


@dataclass
class Link:
    src: str
    dst: str
    type: str
    line: int


@dataclass
class Blueprint:
    path: Path
    meta: dict = field(default_factory=dict)
    title: str = ""
    image: dict = field(default_factory=dict)
    stages: list[Stage] = field(default_factory=list)
    lanes: list[Lane] = field(default_factory=list)
    cards: list[Card] = field(default_factory=list)
    links: list[Link] = field(default_factory=list)
    issues: list[Issue] = field(default_factory=list)

    def err(self, line: int, code: str, msg: str) -> None:
        self.issues.append(Issue(line, "ERROR", code, msg))

    def warn(self, line: int, code: str, msg: str) -> None:
        self.issues.append(Issue(line, "WARN", code, msg))

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.level == "ERROR"]

    def card(self, cid: str) -> Card | None:
        return next((c for c in self.cards if c.id == cid), None)

    def ordered_lanes(self) -> list[tuple[str, str, str, str]]:
        """Дорожки сверху вниз: (id, слой, название, владелец)."""
        out = [(layer, layer, LAYER_TITLE[layer], "") for layer in FIXED_LAYERS]
        for layer in LANE_LAYERS:
            out += [(ln.id, layer, ln.name, ln.owner) for ln in self.lanes if ln.layer == layer]
        return out


def norm_stage(raw: str) -> str:
    s = raw.strip().translate(_LOOKALIKE).upper()
    m = STAGE_RE.match(s)
    return f"С{int(m.group(1))}" if m else ""


def norm_card(raw: str) -> str:
    s = raw.strip().translate(_LOOKALIKE).upper()
    m = CARD_RE.match(s)
    return f"К{int(m.group(1))}" if m else ""


def split_row(line: str) -> list[str]:
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    return [c.strip() for c in s.split("|")]


def _is_sep(line: str) -> bool:
    cells = split_row(line)
    return bool(cells) and all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c) and any(cells)


def tables(lines: list[str], first_lineno: int = 1):
    """Все таблицы в строках: [(header_cells, [(lineno, cells), ...])]."""
    out = []
    i = 0
    while i < len(lines):
        if lines[i].lstrip().startswith("|") and i + 1 < len(lines) and _is_sep(lines[i + 1]):
            header = split_row(lines[i])
            rows = []
            j = i + 2
            while j < len(lines) and lines[j].lstrip().startswith("|"):
                rows.append((first_lineno + j, split_row(lines[j])))
                j += 1
            out.append((header, rows))
            i = j
        else:
            i += 1
    return out


def frontmatter(text: str) -> tuple[dict, int]:
    """(ключи, число строк, занятых frontmatter). Значения — строки, кавычки снимаются."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, 0
    meta = {}
    for n, ln in enumerate(lines[1:], start=2):
        if ln.strip() == "---":
            return meta, n
        if ":" in ln:
            k, _, v = ln.partition(":")
            meta[k.strip()] = v.split("  #")[0].strip().strip("\"'")
    return {}, 0


def source_rev(path: Path) -> str:
    return hashlib.sha1(path.read_bytes()).hexdigest()[:12]


def load_requirements(path: Path) -> tuple[dict[str, str], str]:
    """Требования БФТ: {ID: наименование} и полный текст документа.

    ID берётся из первой колонки любой таблицы (канон deep и «Критичные требования» fast).
    Первое определение побеждает: оно стоит в таблице своего типа.
    """
    text = path.read_text(encoding="utf-8")
    found: dict[str, str] = {}
    for header, rows in tables(text.splitlines()):
        name_col = next((i for i, h in enumerate(header) if "Наименование" in h), None)
        if name_col is None:
            name_col = next((i for i, h in enumerate(header) if h.upper().startswith("TOBE")), None)
        for _, cells in rows:
            if cells and re.fullmatch(REQ_RE, cells[0].strip()):
                rid = cells[0].strip()
                name = cells[name_col] if name_col is not None and name_col < len(cells) else ""
                found.setdefault(rid, name)
    return found, text


def _sections(lines: list[str]) -> dict[str, tuple[int, list[str]]]:
    """H2-секции: {заголовок: (номер строки заголовка, строки тела)}."""
    out: dict[str, tuple[int, list[str]]] = {}
    cur = None
    for n, ln in enumerate(lines, start=1):
        m = re.match(r"^##\s+(.+?)\s*$", ln)
        if m and not ln.startswith("###"):
            cur = m.group(1)
            out[cur] = (n, [])
        elif cur is not None:
            out[cur][1].append(ln)
    return out


def _table_of(bp: Blueprint, secs, name: str):
    """Единственная таблица секции с точным заголовком или None (с диагностикой)."""
    if name not in secs:
        bp.err(1, "BP002", f"нет раздела «{name}»")
        return None
    lineno, body = secs[name]
    found = tables(body, first_lineno=lineno + 1)
    if not found:
        bp.err(lineno, "BP003", f"в разделе «{name}» нет таблицы")
        return None
    header, rows = found[0]
    if tuple(header) != HEADERS[name]:
        bp.err(lineno, "BP003", f"«{name}»: заголовок таблицы должен быть {' | '.join(HEADERS[name])}")
        return None
    return rows


def parse(path: Path) -> Blueprint:
    bp = Blueprint(path=path)
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    bp.meta, _ = frontmatter(text)

    for key in REQUIRED_FRONTMATTER:
        if not bp.meta.get(key):
            bp.err(1, "BP001", f"frontmatter: нет ключа `{key}`")
    if bp.meta.get("stage") and bp.meta["stage"] != "blueprint":
        bp.err(1, "BP001", "frontmatter: `stage` должен быть `blueprint`")
    if bp.meta.get("source_stage") and bp.meta["source_stage"] not in ("fast", "deep"):
        bp.err(1, "BP001", "frontmatter: `source_stage` — `fast` или `deep`")

    h1 = next((ln for ln in lines if ln.startswith("# ")), "")
    bp.title = re.sub(r"^#\s*(\[Blueprint\]\s*)?", "", h1, flags=re.I).strip()
    if not h1.lower().startswith("# [blueprint]"):
        bp.err(1, "BP002", "заголовок H1 должен начинаться с `# [Blueprint]`")

    secs = _sections(lines)
    order = [h for h in secs if h in SECTIONS]
    if order and order != [s for s in SECTIONS if s in order]:
        bp.err(secs[order[0]][0], "BP002", "порядок разделов: " + " → ".join(SECTIONS))

    # Образ результата
    rows = _table_of(bp, secs, "Образ результата")
    if rows is not None:
        bp.image = {c[0].strip("* "): c[1] for _, c in rows if len(c) >= 2}
        for fld in IMAGE_FIELDS:
            if bp.image.get(fld, "").strip() in EMPTY:
                bp.err(secs["Образ результата"][0], "BP019", f"«Образ результата»: нет строки «{fld}»")

    # Стадии
    rows = _table_of(bp, secs, "Стадии")
    seen: set[str] = set()
    for ln, c in rows or []:
        sid = norm_stage(c[0]) if len(c) == 3 else ""
        if not sid or sid in seen or not c[1].strip():
            bp.err(ln, "BP004", f"стадия: ID вида С1…С8 уникален, название не пусто — «{c[0] if c else ''}»")
            continue
        seen.add(sid)
        bp.stages.append(Stage(sid, c[1], c[2], ln))
    if rows is not None and not 2 <= len(bp.stages) <= 8:
        bp.err(secs["Стадии"][0], "BP004", f"стадий должно быть от 2 до 8, сейчас {len(bp.stages)}")

    # Дорожки
    rows = _table_of(bp, secs, "Дорожки")
    lane_ids: set[str] = set(FIXED_LAYERS)
    for ln, c in rows or []:
        if len(c) != 4:
            bp.err(ln, "BP003", "дорожка: четыре колонки")
            continue
        lid, layer = c[0].strip(), c[1].strip().lower()
        if layer not in LANE_LAYERS:
            bp.err(ln, "BP005", f"дорожка «{lid}»: слой `{layer}` — здесь только {', '.join(LANE_LAYERS)}")
            continue
        if not re.fullmatch(r"[a-z][a-z0-9-]*", lid) or lid in lane_ids:
            bp.err(ln, "BP005", f"дорожка: ID `{lid}` — латиница-слаг, уникальный и не совпадающий с именем слоя")
            continue
        if not c[2].strip():
            bp.err(ln, "BP005", f"дорожка «{lid}»: пустое название")
            continue
        lane_ids.add(lid)
        bp.lanes.append(Lane(lid, layer, c[2], c[3], ln))
    if rows is not None and not any(ln.layer == "сервис" for ln in bp.lanes):
        bp.err(secs["Дорожки"][0], "BP005", "нужна хотя бы одна дорожка слоя `сервис`")

    # Карточки
    rows = _table_of(bp, secs, "Карточки")
    stage_ids = {s.id for s in bp.stages}
    card_ids: set[str] = set()
    for ln, c in rows or []:
        if len(c) != 7:
            bp.err(ln, "BP003", "карточка: семь колонок")
            continue
        cid = norm_card(c[0])
        layer = c[1].strip().lower()
        lane = c[2].strip()
        stage = norm_stage(c[3])
        text = c[4].strip()
        kind = c[6].strip().lower()
        if not cid or cid in card_ids:
            bp.err(ln, "BP006", f"карточка: ID вида К1… уникален — «{c[0]}»")
            continue
        card_ids.add(cid)
        if layer not in LAYERS:
            bp.err(ln, "BP006", f"{cid}: слой `{layer}` — один из {', '.join(LAYERS)}")
            continue
        if layer in LANE_LAYERS:
            if lane not in {x.id for x in bp.lanes if x.layer == layer}:
                bp.err(ln, "BP006", f"{cid}: дорожка `{lane}` не объявлена в слое `{layer}`")
                continue
        else:
            if lane not in EMPTY and lane != layer:
                bp.err(ln, "BP006", f"{cid}: у слоя `{layer}` одна дорожка — в колонке «Дорожка» прочерк")
            lane = layer
        if stage not in stage_ids:
            bp.err(ln, "BP006", f"{cid}: стадия «{c[3]}» не объявлена в «Стадиях»")
            continue
        if kind in EMPTY:
            kind = ""
        elif kind not in KINDS:
            bp.err(ln, "BP008", f"{cid}: статус `{kind}` — один из {', '.join(KINDS)} либо прочерк")
            kind = ""
        if layer in BUILD_LAYERS and not kind:
            bp.err(ln, "BP008", f"{cid}: на слое `{layer}` нужен статус ({', '.join(KINDS)})")
        if not text:
            bp.err(ln, "BP007", f"{cid}: пустой текст карточки")
        bp.cards.append(Card(cid, layer, lane, stage, text, REQ_RE.findall(c[5]), kind, ln))

    # Связи
    rows = _table_of(bp, secs, "Связи")
    for ln, c in rows or []:
        if len(c) != 3:
            bp.err(ln, "BP003", "связь: три колонки")
            continue
        src = norm_card(c[0])
        ltype = c[2].strip().lower()
        if ltype not in LINK_TYPES:
            bp.err(ln, "BP010", f"связь: тип `{ltype}` — один из {', '.join(LINK_TYPES)}")
            continue
        for raw in re.split(r"[,;]", c[1]):
            dst = norm_card(raw)
            if not src or not dst:
                bp.err(ln, "BP010", f"связь: «{c[0]} → {raw.strip()}» — ID вида К1…")
            elif src not in card_ids or dst not in card_ids:
                bp.err(ln, "BP010", f"связь {src} → {dst}: карточки нет в «Карточках»")
            elif src == dst:
                bp.err(ln, "BP010", f"связь {src} → {dst}: карточка ссылается на себя")
            else:
                bp.links.append(Link(src, dst, ltype, ln))
    return bp
