#!/usr/bin/env python3
"""Общий разбор `<epic_slug>-map.md` — карты инициативы, второго этапа blueprint.

Карта стоит на согласованной истории (`<epic_slug>-story.md`): этапы, шаги и экраны берутся
оттуда, здесь — что делают команды и как это работает. Разделы:

  Команды      — кто делает; цвет команды назначает страница
  Задачи       — что делаем: одна строка — один результат одной команды на этапе
  IDEF0        — блоки ```idef0 1.2```: вход, управление, выход, механизм, декомпозиция A1…An
  Процессы     — как это работает: Frontstage, Backstage, Support
  Участники    — кто и что участвует в схемах процессов
  Схемы        — блоки ```seq П3```: описание и шаги sequence-диаграммы процесса
  Критерии     — что требуется от процесса
  Цепочка      — что процесс получает и кому отдаёт
  Вопросы      — открытые вопросы и блокеры задач и процессов

Схемы — код (`resources/diagram_dsl.md`): разбор и проверка — `diagram_dsl.py`, коды DG.
Структурные дефекты собираются в `Map.issues`; рендерер по документу с ошибками не рисует.
Только стандартная библиотека.
"""
from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bft_blueprint as bb  # noqa: E402
import bft_story as bs  # noqa: E402
import diagram_dsl as dd  # noqa: E402
import bft_screens as bsn  # noqa: E402
import bft_tasks as btk  # noqa: E402

REQUIRED_FRONTMATTER = (
    "epic_slug", "stage", "story_doc", "source_doc", "source_stage", "source_rev", "version", "revised", "status",
)
SECTIONS = ("Команды", "Задачи", "IDEF0", "Процессы", "Участники", "Схемы", "Критерии", "Цепочка", "Вопросы")
HEADERS = {
    "Команды": ("ID", "Команда"),
    "Задачи": ("ID", "Этап", "Команда", "Задача", "Зачем", "Требования", "Статус"),
    "Процессы": ("ID", "Задача", "Этап", "Слой", "Процесс", "Было", "Станет", "Источник"),
    "Участники": ("ID", "Участник", "Вид"),
    "Критерии": ("Процесс", "Критерий", "Источник"),
    "Цепочка": ("Откуда", "Куда", "Что передаётся"),
    "Вопросы": ("ID", "Кому", "Вопрос", "Где", "Тип", "Ответ"),
}
STATUSES = ("создать", "доработать", "используем", "уточнить")
LAYERS = {"фронтстейдж": "front", "бэкстейдж": "back", "поддержка": "sup"}
KINDS = {"человек": "p", "интерфейс": "i", "система": "s", "внешний": "x"}
Q_TYPES = ("вопрос", "блокер")
FINAL = bs.FINAL  # колонка «Итог» карты — шаги «стало» истории

MAX_TASK = 80
MAX_PROC = 90

TEAM_RE = re.compile(r"^[a-z][a-z0-9-]*$")
TASK_RE = re.compile(r"^\d{1,2}\.\d{1,2}$")
PROC_RE = re.compile(r"^П-?(\d+)$")
QUESTION_RE = bs.QUESTION_RE
PART_RE = re.compile(r"^[A-Za-z][A-Za-z0-9]{0,7}$")
UNKNOWN_TEAM = re.compile(r"^\?\s*(?:\((.+)\))?$")
EMPTY = bb.EMPTY


@dataclass
class Team:
    id: str
    name: str
    line: int


@dataclass
class Task:
    id: str
    stage: str
    team: str        # ID команды или «?» — команда не определена
    candidates: str  # кандидаты, если команда не определена
    text: str
    why: str
    reqs: list[str]
    status: str
    line: int


@dataclass
class Idef:
    task: str
    inputs: list[str]
    controls: list[str]
    outputs: list[str]
    mechanisms: list[str]
    line: int
    fn: str = ""                                        # название функции, если не текст задачи
    children: list = field(default_factory=list)        # декомпозиция A1…An
    src: str = ""                                       # текст блока как в документе


@dataclass
class Process:
    id: str
    task: str
    stage: str
    layer: str  # front | back | sup
    text: str
    before: str
    after: str
    source: str
    line: int
    desc: str = ""                                      # «описание:» из блока схемы
    parts: dict = field(default_factory=dict)           # участники, объявленные в блоке
    src: str = ""                                       # текст блока схемы как в документе


@dataclass
class Participant:
    id: str
    name: str
    kind: str  # p | i | s | x
    line: int


@dataclass
class Step:
    process: str
    branch: str  # "" | "если: …" | "иначе: …"
    src: str
    dst: str
    text: str
    kind: str  # вызов | ответ
    line: int


@dataclass
class Criterion:
    process: str
    text: str
    source: str
    line: int

    @property
    def state(self) -> str:
        if "БЛОКЕР" in self.text:
            return "blocker"
        return "ask" if bb.MARKER in self.text else "ok"


@dataclass
class Link:
    src: str
    dst: str
    what: str
    line: int


@dataclass
class Question:
    id: str
    to: str
    text: str
    where: str
    kind: str
    answer: str
    line: int

    @property
    def open(self) -> bool:
        return self.answer.strip() in EMPTY


@dataclass
class Map:
    path: Path
    meta: dict = field(default_factory=dict)
    title: str = ""
    story: bs.Story | None = None
    teams: list[Team] = field(default_factory=list)
    tasks: list[Task] = field(default_factory=list)
    idef: list[Idef] = field(default_factory=list)
    processes: list[Process] = field(default_factory=list)
    parts: list[Participant] = field(default_factory=list)
    steps: list[Step] = field(default_factory=list)
    criteria: list[Criterion] = field(default_factory=list)
    links: list[Link] = field(default_factory=list)
    questions: list[Question] = field(default_factory=list)
    issues: list[bb.Issue] = field(default_factory=list)
    screens: dict = field(default_factory=dict)  # требования к экранам: {ID: bsn.ScreenDoc}
    briefs: dict = field(default_factory=dict)   # постановки задач: {ID: btk.TaskDoc}

    def err(self, line: int, code: str, msg: str) -> None:
        self.issues.append(bb.Issue(line, "ERROR", code, msg))

    def warn(self, line: int, code: str, msg: str) -> None:
        self.issues.append(bb.Issue(line, "WARN", code, msg))

    @property
    def errors(self) -> list[bb.Issue]:
        return [i for i in self.issues if i.level == "ERROR"]

    def task(self, tid: str) -> Task | None:
        return next((t for t in self.tasks if t.id == tid), None)

    def process(self, pid: str) -> Process | None:
        return next((p for p in self.processes if p.id == pid), None)


def norm_proc(raw: str) -> str:
    m = PROC_RE.match(raw.strip().upper())
    return f"П{int(m.group(1))}" if m else ""


def _table_of(mp: Map, secs, name: str):
    if name not in secs:
        mp.err(1, "MP002", f"нет раздела «{name}»")
        return None
    lineno, body = secs[name]
    found = bb.tables(body, first_lineno=lineno + 1)
    if not found:
        mp.err(lineno, "MP003", f"в разделе «{name}» нет таблицы")
        return None
    header, rows = found[0]
    if tuple(header) != HEADERS[name]:
        mp.err(lineno, "MP003", f"«{name}»: заголовок таблицы должен быть {' | '.join(HEADERS[name])}")
        return None
    width = len(HEADERS[name])
    good = []
    for ln, c in rows:
        if len(c) != width:
            mp.err(ln, "MP003", f"«{name}»: в строке {len(c)} колонок, нужно {width}")
        else:
            good.append((ln, c))
    return good


def _blocks_of(mp: Map, secs, name: str, kind: str):
    """Блоки ```kind ID``` раздела: [(строка заголовка, ID, тело, текст блока)]. Вне блоков — только пустые строки."""
    if name not in secs:
        mp.err(1, "MP002", f"нет раздела «{name}»")
        return []
    lineno, body = secs[name]
    out, i = [], 0
    while i < len(body):
        ln = body[i].strip()
        m = dd.FENCE_RE.match(ln)
        if m:
            j = i + 1
            while j < len(body) and not dd.FENCE_END.match(body[j].strip()):
                j += 1
            fence = lineno + 1 + i
            if j >= len(body):
                mp.err(fence, "DG000", f"«{name}»: блок не закрыт строкой ```")
            if m.group(1) != kind:
                mp.err(fence, "MP003", f"«{name}»: здесь блоки ```{kind} …```, а не ```{m.group(1)}```")
            else:
                out.append((fence, m.group(2).strip(), body[i + 1:j], "\n".join(x.rstrip() for x in body[i:j + 1])))
            i = j + 1
            continue
        if ln:
            hint = "таблица — прежний формат" if ln.startswith("|") else "текст вне блока"
            mp.err(lineno + 1 + i, "MP003", f"«{name}»: {hint}; раздел — блоки ```{kind} {'П3' if kind == 'seq' else '1.2'} … ``` (resources/diagram_dsl.md)")
        i += 1
    return out


def _dsl_issues(mp: Map, fence: int, issues: list) -> None:
    for i in issues:
        mp.issues.append(bb.Issue(fence + i["line"], i["level"], i["code"], i["msg"]))


def stage_ids(mp: Map) -> set[str]:
    ids = {s.id for s in mp.story.stages} if mp.story else set()
    return ids | {FINAL}


def parse(path: Path) -> Map:
    mp = Map(path=path)
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    mp.meta, _ = bb.frontmatter(text)

    for key in REQUIRED_FRONTMATTER:
        if not mp.meta.get(key):
            mp.err(1, "MP001", f"frontmatter: нет ключа `{key}`")
    if mp.meta.get("stage") and mp.meta["stage"] != "map":
        mp.err(1, "MP001", "frontmatter: `stage` должен быть `map`")

    h1 = next((ln for ln in lines if ln.startswith("# ")), "")
    mp.title = re.sub(r"^#\s*(\[Карта\]\s*)?", "", h1).strip()
    if not h1.startswith("# [Карта]"):
        mp.err(1, "MP002", "заголовок H1 должен начинаться с `# [Карта]`")

    # История — основа карты: этапы, шаги, экраны
    if mp.meta.get("story_doc"):
        sp = path.parent / mp.meta["story_doc"]
        if not sp.is_file():
            mp.err(1, "MP004", f"история не найдена: {mp.meta['story_doc']} — карта собирается после этапа story")
        else:
            mp.story = bs.parse(sp)
            if mp.story.errors:
                mp.err(1, "MP004", f"в истории {sp.name} ошибки ({len(mp.story.errors)}) — сначала bft-story-lint.py")

    secs = bb._sections(lines)
    order = [h for h in secs if h in SECTIONS]
    if order and order != [s for s in SECTIONS if s in order]:
        mp.err(secs[order[0]][0], "MP002", "порядок разделов: " + " → ".join(SECTIONS))
    stages = stage_ids(mp)

    # Команды
    for ln, c in _table_of(mp, secs, "Команды") or []:
        tid = c[0].strip()
        if not TEAM_RE.match(tid) or any(t.id == tid for t in mp.teams) or not c[1].strip():
            mp.err(ln, "MP005", f"команда: ID — латиница-слаг, уникален, название не пусто — «{tid}»")
            continue
        mp.teams.append(Team(tid, c[1].strip(), ln))
    team_ids = {t.id for t in mp.teams}

    # Задачи
    for ln, c in _table_of(mp, secs, "Задачи") or []:
        tid = c[0].strip()
        if not TASK_RE.match(tid) or mp.task(tid):
            mp.err(ln, "MP006", f"задача: ID вида 1.2, уникален — «{tid}»")
            continue
        stage = c[1].strip().upper() if c[1].strip().lower() != FINAL else FINAL
        if mp.story and stage not in stages:
            mp.err(ln, "MP006", f"{tid}: этап «{c[1]}» — ID этапа истории или `стало`")
        team, cand = c[2].strip(), ""
        m = UNKNOWN_TEAM.match(team)
        if m:
            team, cand = "?", (m.group(1) or "").strip()
        elif team not in team_ids:
            mp.err(ln, "MP006", f"{tid}: команды «{team}» нет в «Командах»; не определена — «? (кандидаты)»")
        status = c[6].strip().lower()
        if status not in STATUSES:
            mp.err(ln, "MP006", f"{tid}: статус «{c[6]}» — один из {', '.join(STATUSES)}")
        if not c[3].strip():
            mp.err(ln, "MP006", f"{tid}: пустая задача")
        mp.tasks.append(Task(tid, stage, team, cand, c[3].strip(), c[4].strip(), bb.REQ_RE.findall(c[5]), status, ln))
    task_ids = {t.id for t in mp.tasks}

    # IDEF0 — блоки ```idef0 1.2```
    for fence, tid, body, src in _blocks_of(mp, secs, "IDEF0", "idef0"):
        if not dd.IDEF_ID.match(tid) or tid not in task_ids:
            mp.err(fence, "MP007", f"IDEF0: задачи «{tid}» нет в «Задачах» — заголовок ```idef0 1.2```")
            continue
        if any(i.task == tid for i in mp.idef):
            mp.err(fence, "MP007", f"IDEF0 {tid}: второй блок — один блок на задачу")
            continue
        res = dd.parse_idef(body)
        _dsl_issues(mp, fence, res["issues"])
        mp.idef.append(Idef(tid, res["in"], res["ctl"], res["out"], res["mech"], fence,
                            res["fn"], res["children"], src))

    # Процессы
    for ln, c in _table_of(mp, secs, "Процессы") or []:
        pid = norm_proc(c[0])
        if not pid or mp.process(pid):
            mp.err(ln, "MP008", f"процесс: ID вида П1, уникален — «{c[0]}»")
            continue
        tid = c[1].strip()
        if tid not in task_ids:
            mp.err(ln, "MP008", f"{pid}: задачи «{tid}» нет в «Задачах» — процесс всегда чья-то работа")
        stage = c[2].strip().upper() if c[2].strip().lower() != FINAL else FINAL
        if mp.story and stage not in stages:
            mp.err(ln, "MP008", f"{pid}: этап «{c[2]}» — ID этапа истории или `стало`")
        layer = LAYERS.get(c[3].strip().lower())
        if not layer:
            mp.err(ln, "MP008", f"{pid}: слой «{c[3]}» — один из {', '.join(LAYERS)}")
            continue
        if not c[4].strip():
            mp.err(ln, "MP008", f"{pid}: пустое описание процесса")
        mp.processes.append(Process(pid, tid, stage, layer, c[4].strip(),
                                    "" if c[5].strip() in EMPTY else c[5].strip(),
                                    "" if c[6].strip() in EMPTY else c[6].strip(), c[7].strip(), ln))
    proc_ids = {p.id for p in mp.processes}

    # Участники
    for ln, c in _table_of(mp, secs, "Участники") or []:
        pid = c[0].strip()
        kind = KINDS.get(c[2].strip().lower())
        if not PART_RE.match(pid) or any(p.id == pid for p in mp.parts) or not c[1].strip():
            mp.err(ln, "MP009", f"участник: ID — латиница до 8 знаков, уникален — «{pid}»")
            continue
        if not kind:
            mp.err(ln, "MP009", f"{pid}: вид «{c[2]}» — один из {', '.join(KINDS)}")
            continue
        mp.parts.append(Participant(pid, c[1].strip(), kind, ln))

    # Схемы — блоки ```seq П3```
    known = {p.id: [p.name, p.kind] for p in mp.parts}
    seen_seq: set[str] = set()
    for fence, raw, body, src in _blocks_of(mp, secs, "Схемы", "seq"):
        pid = norm_proc(raw)
        if pid not in proc_ids:
            mp.err(fence, "MP010", f"схема: процесса «{raw}» нет в «Процессах» — заголовок ```seq П3```")
            continue
        if pid in seen_seq:
            mp.err(fence, "MP010", f"схема {pid}: второй блок — один блок на процесс")
            continue
        seen_seq.add(pid)
        res = dd.parse_seq(body, known)
        _dsl_issues(mp, fence, res["issues"])
        proc = mp.process(pid)
        proc.desc, proc.parts, proc.src = res["desc"], res["parts"], src
        for st in res["steps"]:
            mp.steps.append(Step(pid, st["branch"], st["src"], st["dst"], st["text"], st["kind"], fence + st["line"]))

    # Критерии
    for ln, c in _table_of(mp, secs, "Критерии") or []:
        pid = norm_proc(c[0])
        if pid not in proc_ids:
            mp.err(ln, "MP011", f"критерий: процесса «{c[0]}» нет в «Процессах»")
            continue
        if not c[1].strip():
            mp.err(ln, "MP011", f"{pid}: пустой критерий")
            continue
        mp.criteria.append(Criterion(pid, c[1].strip(), c[2].strip(), ln))

    # Цепочка: ID процесса или событие текстом
    for ln, c in _table_of(mp, secs, "Цепочка") or []:
        ends = []
        for raw in (c[0], c[1]):
            pid = norm_proc(raw)
            if PROC_RE.match(raw.strip().upper()) and pid not in proc_ids:
                mp.err(ln, "MP012", f"цепочка: процесса «{raw.strip()}» нет в «Процессах»")
            ends.append(pid if pid else raw.strip())
        if not any(PROC_RE.match(e) for e in ends):
            mp.err(ln, "MP012", "цепочка: хотя бы один конец — ID процесса")
            continue
        mp.links.append(Link(ends[0], ends[1], c[2].strip(), ln))

    # Вопросы
    for ln, c in _table_of(mp, secs, "Вопросы") or []:
        qid = bs.norm_question(c[0])
        if not qid or any(q.id == qid for q in mp.questions):
            mp.err(ln, "MP013", f"вопрос: ID вида В1, уникален — «{c[0]}»")
            continue
        where = c[3].strip()
        where_n = norm_proc(where) or where
        if where_n not in task_ids | proc_ids:
            mp.err(ln, "MP013", f"{qid}: «Где» — ID задачи (1.2) или процесса (П3), а не «{where}»")
        kind = c[4].strip().lower()
        if kind not in Q_TYPES:
            mp.err(ln, "MP013", f"{qid}: тип «{c[4]}» — вопрос или блокер")
        if not c[1].strip() or not c[2].strip():
            mp.err(ln, "MP013", f"{qid}: нужны «Кому» и «Вопрос»")
        mp.questions.append(Question(qid, c[1].strip(), c[2].strip(), where_n, kind, c[5].strip(), ln))

    # Требования к экранам — screens/<ID>.md рядом с картой
    if mp.story:
        mp.screens, sn_issues = bsn.check(path, {sc.id for sc in mp.story.screens})
        mp.issues.extend(sn_issues)

    # Постановки задач для техлида — tasks/<ID>.md рядом с картой
    mp.briefs, tk_issues = btk.check(path, task_ids)
    mp.issues.extend(tk_issues)
    return mp
