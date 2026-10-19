#!/usr/bin/env python3
"""Общий разбор `<epic_slug>-story.md` — верхней линии blueprint: истории через экраны.

Документ истории — набор markdown-таблиц, как blueprint и сам БФТ. Здесь они превращаются в
модель: этапы, персонажи, шаги, экраны, вопросы. Структурные дефекты собираются в
`Story.issues` и не бросают исключений: линтер печатает их все разом, рендерер отказывается
рисовать при ошибках.

Состав экрана — короткий DSL (`resources/story_line.md` §«Состав экрана»): элементы через `;`,
у каждого ключевое слово и, если нужно, текст после двоеточия. Разбор и оценка высоты экрана —
здесь же, чтобы линтер и рендерер видели экран одинаково.

Только стандартная библиотека.
"""
from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bft_blueprint as bb  # noqa: E402  (таблицы, frontmatter, sha БФТ, требования)

REQUIRED_FRONTMATTER = (
    "epic_slug", "stage", "source_doc", "source_stage", "source_rev", "version", "revised", "status",
)
SECTIONS = ("Этапы", "Персонажи", "Шаги", "Экраны", "Вопросы")
HEADERS = {
    "Этапы": ("ID", "Этап", "Когда"),
    "Персонажи": ("ID", "Персонаж", "Дорожка", "Было", "Стало", "Источник"),
    "Шаги": ("ID", "Персонаж", "Этап", "Заголовок", "Пояснение", "Экраны", "Раньше", "Источник"),
    "Экраны": ("ID", "Контур", "Устройство", "Вид", "Состав", "Источник"),
    "Вопросы": ("ID", "Кому", "Вопрос", "Где", "Ответ"),
}
INTRO, FINAL = "было", "стало"
DEVICES = {"браузер": "web", "письмо": "mail", "уведомление": "lock", "приложение": "phone"}
VIEWS = ("основной", "альтернативный", "неизвестен")

MAX_TITLE = 50       # заголовок шага читается за секунду
MAX_TEXT = 120       # пояснение — одна-две фразы
MAX_SCREENS = 2      # на карточке шага; остальные состояния — в деталях раздела
MAX_STEPS = 9        # шагов у персонажа без «было» и «стало»: дальше история не читается

EMPTY = bb.EMPTY
REQ_RE = bb.REQ_RE
_LOOKALIKE = str.maketrans({"B": "В", "b": "В", "в": "В"})
STAGE_ID_RE = re.compile(r"^[A-H]$")
STEP_RE = re.compile(r"^Ш-?(\d+)$")
QUESTION_RE = re.compile(r"^В-?(\d+)$")
SCREEN_RE = re.compile(r"^[A-H]\d{1,2}$")
PERSONA_RE = re.compile(r"^[a-z][a-z0-9-]*$")

# --- состав экрана -----------------------------------------------------------------------
# ключевое слово → (код элемента для рендера, нужен ли текст)
ELEMENTS = {
    "заголовок": ("hdr", True),
    "отметка": ("hdr", True),       # заголовок с галочкой: «✓ Билет куплен»
    "текст": ("text", True),
    "оффер": ("offer", True),
    "кнопка": ("cta", True),
    "кнопка-контур": ("cta2", True),
    "ссылка": ("link", True),
    "плитки": ("tiles", False),
    "список": ("rows", False),      # «список: 3» — число строк, по умолчанию 3
    "список-оффер": ("rowsOffer", False),  # то же, у каждой строки плашка оффера
    "фильтры": ("chips", True),     # «фильтры: Персоны, Метро, +3»
    "поле": ("kv", True),           # «поле: Окно = 7 дней»
    "картинка": ("img", False),
    "камера": ("camera", False),
    "успех": ("ok", True),
    "отказ": ("no", True),
    "уведомление": ("notif", True),  # «уведомление: Отправитель / Заголовок / Текст»
    "штрихкод": ("barcode", False),
    "отправитель": ("from", True),   # только у письма: строка отправителя над темой
}
SCREEN_W, SCREEN_H = 150, 250
START_Y = {"web": 26, "mail": 12, "lock": 78, "phone": 24}


def wrap(text: str, n: int) -> list[str]:
    """Перенос по словам — тот же, что `wrapT` в story_page.js: высоты должны совпасть."""
    out, cur = [], ""
    for w in str(text).split(" "):
        if len((cur + " " + w).strip()) > n:
            if cur:
                out.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    if cur:
        out.append(cur)
    return out


def element_height(el: list) -> int:
    k = el[0]
    if k == "hdr":
        return 22
    if k == "text":
        return len(wrap(el[1], 22)) * 13 + 5
    if k == "offer":
        return len(wrap(el[1], 13)) * 16 + 16 + 9
    if k in ("cta", "cta2"):
        return 32
    if k == "link":
        return 22
    if k == "tiles":
        return 66
    if k in ("rows", "rowsOffer"):
        return el[1] * 34
    if k == "chips":
        return 30
    if k == "kv":
        return 24
    if k == "img":
        return 64
    if k == "camera":
        return 120
    if k in ("ok", "no"):
        return 86
    if k == "barcode":
        return 80
    if k == "notif":
        return 34 + len(wrap(el[2], 17)) * 15 + len(wrap(el[3], 20)) * 13 + 10
    if k == "from":
        return 22
    return 0


def parse_composition(raw: str) -> tuple[list, list[str]]:
    """«заголовок: Все рестораны; фильтры: Персоны, Метро; список: 3» → элементы и ошибки."""
    elements, errors = [], []
    for part in [p.strip() for p in raw.split(";") if p.strip()]:
        key, _, val = part.partition(":")
        key, val = key.strip().lower(), val.strip()
        if key not in ELEMENTS:
            errors.append(f"неизвестный элемент «{key}» — допустимы: {', '.join(ELEMENTS)}")
            continue
        code, needs_text = ELEMENTS[key]
        if needs_text and not val:
            errors.append(f"«{key}» без текста: «{key}: …»")
            continue
        if code == "hdr":
            elements.append(["hdr", ("✓ " if key == "отметка" else "") + val])
        elif code in ("rows", "rowsOffer"):
            n = int(val) if val.isdigit() else 3
            if not 1 <= n <= 5:
                errors.append(f"«{key}»: от 1 до 5 строк")
                continue
            elements.append([code, n])
        elif code == "chips":
            elements.append(["chips", [c.strip() for c in val.split(",") if c.strip()]])
        elif code == "kv":
            k, sep, v = val.partition("=")
            if not sep or not k.strip() or not v.strip():
                errors.append("«поле»: «поле: Подпись = значение»")
                continue
            elements.append(["kv", k.strip(), v.strip()])
        elif code == "notif":
            bits = [b.strip() for b in val.split("/")]
            if len(bits) != 3 or not all(bits):
                errors.append("«уведомление»: «уведомление: Отправитель / Заголовок / Текст»")
                continue
            elements.append(["notif", *bits])
        elif needs_text:
            elements.append([code, val])
        else:
            elements.append([code])
    return elements, errors


# --- модель ------------------------------------------------------------------------------
@dataclass
class Stage:
    id: str
    name: str
    when: str
    line: int


@dataclass
class Persona:
    id: str
    name: str
    lane: str
    before: str  # крупное число «было» с подписью: «<1% · узнавали о скидке»
    after: str
    source: str
    line: int


@dataclass
class Step:
    id: str
    persona: str
    stage_from: str  # ID этапа, «было» или «стало»
    stage_to: str    # для полосы ожидания — последний этап диапазона; иначе = stage_from
    title: str
    text: str
    screens: list[str]
    was: str         # «Раньше»
    source: str
    line: int

    @property
    def kind(self) -> str:
        if self.stage_from == INTRO:
            return "intro"
        if self.stage_from == FINAL:
            return "final"
        return "step" if self.screens else "band"


@dataclass
class Screen:
    id: str
    contour: str
    device: str  # web | mail | lock | phone
    view: str
    elements: list
    source: str
    line: int


@dataclass
class Question:
    id: str
    to: str
    text: str
    where: str
    answer: str
    line: int

    @property
    def open(self) -> bool:
        return self.answer.strip() in EMPTY


@dataclass
class Story:
    path: Path
    meta: dict = field(default_factory=dict)
    title: str = ""
    stages: list[Stage] = field(default_factory=list)
    personas: list[Persona] = field(default_factory=list)
    steps: list[Step] = field(default_factory=list)
    screens: list[Screen] = field(default_factory=list)
    questions: list[Question] = field(default_factory=list)
    issues: list[bb.Issue] = field(default_factory=list)

    def err(self, line: int, code: str, msg: str) -> None:
        self.issues.append(bb.Issue(line, "ERROR", code, msg))

    def warn(self, line: int, code: str, msg: str) -> None:
        self.issues.append(bb.Issue(line, "WARN", code, msg))

    @property
    def errors(self) -> list[bb.Issue]:
        return [i for i in self.issues if i.level == "ERROR"]

    def screen(self, sid: str) -> Screen | None:
        return next((s for s in self.screens if s.id == sid), None)

    def stage_index(self, sid: str) -> int:
        """Колонка этапа: 0 — «было», 1…N — этапы, N+1 — «стало»."""
        if sid == INTRO:
            return 0
        if sid == FINAL:
            return len(self.stages) + 1
        return next(i for i, s in enumerate(self.stages, start=1) if s.id == sid)

    def steps_of(self, pid: str) -> list[Step]:
        return [s for s in self.steps if s.persona == pid]


def _norm(raw: str) -> str:
    return raw.strip().upper()


def norm_step(raw: str) -> str:
    m = STEP_RE.match(raw.strip().upper())
    return f"Ш{int(m.group(1))}" if m else ""


def norm_question(raw: str) -> str:
    m = QUESTION_RE.match(raw.strip().translate(_LOOKALIKE).upper())
    return f"В{int(m.group(1))}" if m else ""


def _table_of(st: Story, secs, name: str):
    if name not in secs:
        st.err(1, "ST002", f"нет раздела «{name}»")
        return None
    lineno, body = secs[name]
    found = bb.tables(body, first_lineno=lineno + 1)
    if not found:
        st.err(lineno, "ST003", f"в разделе «{name}» нет таблицы")
        return None
    header, rows = found[0]
    if tuple(header) != HEADERS[name]:
        st.err(lineno, "ST003", f"«{name}»: заголовок таблицы должен быть {' | '.join(HEADERS[name])}")
        return None
    width = len(HEADERS[name])
    good = []
    for ln, c in rows:
        if len(c) != width:
            st.err(ln, "ST003", f"«{name}»: в строке {len(c)} колонок, нужно {width}")
        else:
            good.append((ln, c))
    return good


def parse(path: Path, text: str | None = None) -> Story:
    """Разбор истории. `text` — если история не в своём файле (документ «История» проекта Backlog.md)."""
    st = Story(path=path)
    if text is None:
        text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    st.meta, _ = bb.frontmatter(text)

    for key in REQUIRED_FRONTMATTER:
        if not st.meta.get(key):
            st.err(1, "ST001", f"frontmatter: нет ключа `{key}`")
    if st.meta.get("stage") and st.meta["stage"] != "story":
        st.err(1, "ST001", "frontmatter: `stage` должен быть `story`")
    if st.meta.get("source_stage") and st.meta["source_stage"] not in ("fast", "deep"):
        st.err(1, "ST001", "frontmatter: `source_stage` — `fast` или `deep`")

    h1 = next((ln for ln in lines if ln.startswith("# ")), "")
    st.title = re.sub(r"^#\s*(\[История\]\s*)?", "", h1).strip()
    if not h1.startswith("# [История]"):
        st.err(1, "ST002", "заголовок H1 должен начинаться с `# [История]`")

    secs = bb._sections(lines)
    order = [h for h in secs if h in SECTIONS]
    if order and order != [s for s in SECTIONS if s in order]:
        st.err(secs[order[0]][0], "ST002", "порядок разделов: " + " → ".join(SECTIONS))

    # Этапы
    rows = _table_of(st, secs, "Этапы")
    for ln, c in rows or []:
        sid = _norm(c[0])
        if not STAGE_ID_RE.match(sid) or any(s.id == sid for s in st.stages) or not c[1].strip():
            st.err(ln, "ST004", f"этап: ID — латинская буква A…H, уникален, название не пусто — «{c[0]}»")
            continue
        st.stages.append(Stage(sid, c[1].strip(), c[2].strip() if c[2].strip() not in EMPTY else "", ln))
    if rows is not None:
        if not 2 <= len(st.stages) <= 8:
            st.err(secs["Этапы"][0], "ST004", f"этапов должно быть от 2 до 8, сейчас {len(st.stages)}")
        ids = [s.id for s in st.stages]
        if ids != sorted(ids):
            st.err(secs["Этапы"][0], "ST004", "этапы идут по алфавиту: A, B, C… — это порядок чтения слева направо")

    # Персонажи
    rows = _table_of(st, secs, "Персонажи")
    for ln, c in rows or []:
        pid = c[0].strip()
        if not PERSONA_RE.match(pid) or any(p.id == pid for p in st.personas):
            st.err(ln, "ST005", f"персонаж: ID — латиница-слаг, уникален — «{pid}»")
            continue
        if not c[1].strip() or not c[2].strip():
            st.err(ln, "ST005", f"персонаж «{pid}»: нужны имя и подпись дорожки")
            continue
        st.personas.append(Persona(pid, c[1].strip(), c[2].strip(), c[3].strip(), c[4].strip(), c[5].strip(), ln))
    if rows is not None and not 1 <= len(st.personas) <= 3:
        st.err(secs["Персонажи"][0], "ST005", f"персонажей от 1 до 3, сейчас {len(st.personas)}: больше — история не читается")

    # Экраны (до шагов: шаги на них ссылаются)
    rows = _table_of(st, secs, "Экраны")
    for ln, c in rows or []:
        sid = _norm(c[0])
        if not SCREEN_RE.match(sid) or st.screen(sid):
            st.err(ln, "ST009", f"экран: ID — буква этапа и номер (A1, C2), уникален — «{c[0]}»")
            continue
        device = DEVICES.get(c[2].strip().lower())
        if not device:
            st.err(ln, "ST009", f"{sid}: устройство «{c[2]}» — одно из {', '.join(DEVICES)}")
            continue
        view = c[3].strip().lower()
        if view not in VIEWS:
            st.err(ln, "ST009", f"{sid}: вид «{c[3]}» — один из {', '.join(VIEWS)}")
            continue
        if c[1].strip() in EMPTY:
            st.err(ln, "ST010", f"{sid}: пустой контур — где человек видит этот экран (витрина, письмо, SMS…)")
        elements: list = []
        if c[4].strip() not in EMPTY:
            elements, errs = parse_composition(c[4])
            for e in errs:
                st.err(ln, "ST009", f"{sid}: {e}")
        if view != "неизвестен" and not elements:
            st.err(ln, "ST009", f"{sid}: пустой состав — экран без содержимого рисуется только с видом `неизвестен`")
        if device != "mail" and any(e[0] == "from" for e in elements):
            st.err(ln, "ST009", f"{sid}: «отправитель» бывает только у письма")
        height = START_Y[device] + sum(element_height(e) for e in elements)
        if height > SCREEN_H - 6:
            st.err(ln, "ST008", f"{sid}: экран не помещается ({height} из {SCREEN_H - 6}) — оставь главное, остальное уйдёт в детали раздела")
        st.screens.append(Screen(sid, c[1].strip(), device, view, elements, c[5].strip(), ln))

    # Шаги
    rows = _table_of(st, secs, "Шаги")
    stage_ids = {s.id for s in st.stages}
    persona_ids = {p.id for p in st.personas}
    for ln, c in rows or []:
        sid = norm_step(c[0])
        if not sid or any(s.id == sid for s in st.steps):
            st.err(ln, "ST006", f"шаг: ID вида Ш1… уникален — «{c[0]}»")
            continue
        pid = c[1].strip()
        if pid not in persona_ids:
            st.err(ln, "ST006", f"{sid}: персонаж «{pid}» не объявлен в «Персонажах»")
            continue
        raw = c[2].strip().lower()
        if raw in (INTRO, FINAL):
            s_from = s_to = raw
        else:
            bits = [_norm(b) for b in re.split(r"\s*[–—-]\s*", c[2].strip()) if b.strip()]
            if not 1 <= len(bits) <= 2 or any(b not in stage_ids for b in bits):
                st.err(ln, "ST006", f"{sid}: этап «{c[2]}» — ID из «Этапов», диапазон «B–D», либо `было` / `стало`")
                continue
            s_from, s_to = bits[0], bits[-1]
            if s_to < s_from:
                st.err(ln, "ST006", f"{sid}: диапазон этапов идёт слева направо")
                continue
        screens = [] if c[5].strip() in EMPTY else [_norm(x) for x in re.split(r"[,;]", c[5]) if x.strip()]
        for x in screens:
            if not st.screen(x):
                st.err(ln, "ST009", f"{sid}: экрана {x} нет в «Экранах»")
        st.steps.append(Step(sid, pid, s_from, s_to, c[3].strip(), c[4].strip(), screens,
                             "" if c[6].strip() in EMPTY else c[6].strip(), c[7].strip(), ln))

    # Вопросы
    rows = _table_of(st, secs, "Вопросы")
    step_ids = {s.id for s in st.steps}
    screen_ids = {s.id for s in st.screens}
    for ln, c in rows or []:
        qid = norm_question(c[0])
        if not qid or any(q.id == qid for q in st.questions):
            st.err(ln, "ST015", f"вопрос: ID вида В1… уникален — «{c[0]}»")
            continue
        where = c[3].strip()
        where_n = norm_step(where) or _norm(where)
        if where_n not in step_ids | screen_ids and where not in EMPTY:
            st.err(ln, "ST015", f"{qid}: «Где» — ID шага (Ш3) или экрана (D1), а не «{where}»")
            continue
        if not c[1].strip() or not c[2].strip():
            st.err(ln, "ST015", f"{qid}: нужны «Кому» и «Вопрос»")
            continue
        st.questions.append(Question(qid, c[1].strip(), c[2].strip(), "" if where in EMPTY else where_n, c[4].strip(), ln))
    return st
