#!/usr/bin/env python3
"""Service Blueprint в проекте Backlog.md — разбор и проверка формы.

Карта инициативы живёт в обычном проекте Backlog.md (`backlog init`): задачи, подзадачи и документы —
markdown-файлы, которыми ИИ-агент управляет через CLI `backlog`. Отсюда страница карты собирается
детерминированно (`bft-backlog-build.py`).

  backlog/config.yml                         task_prefix — префикс ID (bp → BP-12)
  backlog/docs/doc-… - Карта.md               паспорт <!-- bft-map … -->, «Команды», «Вопросы»
  backlog/docs/doc-… - История.md             история через экраны <!-- bft-story … -->
  backlog/docs/screens/doc-… - F3 · ….md      требования к экрану для дизайнера
  backlog/tasks/bp-12 - ….md                  «Что делаем»: задача команды — постановка для техлида
  backlog/tasks/bp-12.1 - ….md                «Как это работает»: подзадача — техническая карточка

На карте — задачи с меткой `stage:<этап>`. Остальные задачи проекта (план работ, баги) карте не мешают.

Задача «Что делаем»: исполнитель — команда (`@teama`) или метки `кандидат:<команда>`, метки этапа
и вида (создать, доработать, используем, уточнить). Описание: зачем; «Требования БФТ: …»;
### ASIS, GAP, TOBE, HowToDemo, Дополнительно. Чеклист приемки — Acceptance Criteria.
Исполнение — references (JIRA, Confluence) и Implementation Notes.

Карточка «Как это работает»: подзадача задачи «Что делаем», метки `layer:<слой>` и `stage:<этап>`.
Описание: суть одной-двумя фразами; ### UserStory «Как …, я хочу …, чтобы …»; ### JobStory — ситуации
«Когда …, хочу …, чтобы …»; ### Параметры (вход, управление, выход, механизм); ### Процесс — шаги
«Участник: действие» и развилки «? вопрос» с ветками «ответ → Участник: действие»; ### BPMN — mermaid,
собирается из процесса; ### HowToDemo. Ссылки — documentation, references.
Ссылка `(BP-8.1)` во входе или управлении — откуда пришло, в выходе — куда уходит: это стрелки карты.

Стандарт — `resources/backlog_rules.md`. Только стандартная библиотека.
"""
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bft_blueprint as bb  # noqa: E402
import bft_story as bs  # noqa: E402
import bft_screens as bsn  # noqa: E402

FINAL = bs.FINAL
KINDS = ("создать", "доработать", "используем", "уточнить")
LAYERS = ("employee", "technology", "backstage", "support")
BRIEF = ("ASIS", "GAP", "TOBE", "HowToDemo", "Дополнительно")
BRIEF_OPTIONAL = {"Дополнительно"}
CARD = ("UserStory", "JobStory", "Параметры", "Процесс", "BPMN", "HowToDemo")
CARD_REQUIRED = ("UserStory", "JobStory", "Параметры", "Процесс", "HowToDemo")
MAX_STEPS = 12          # шагов процесса — дальше схема не читается, карточку делят на две
MAX_LANES = 6
PARAM_KEYS = {"вход": "in", "входы": "in", "управление": "ctl", "выход": "out", "выходы": "out",
              "механизм": "mech", "механизмы": "mech"}
PARAM_NAME = {"in": "Вход", "ctl": "Управление", "out": "Выход", "mech": "Механизм"}
MAP_META = ("epic_slug", "source_doc", "source_stage", "source_rev", "version", "revised", "status")
TEAMS_HEADER = ("ID", "Команда")
QUESTIONS_HEADER = ("ID", "Кому", "Вопрос", "Где", "Тип", "Ответ")
Q_TYPES = ("вопрос", "блокер")
MAX_TASK = 80
MAX_CARD = 90

TEAM_RE = re.compile(r"^[a-z][a-z0-9-]*$")
SCREEN_TITLE = re.compile(r"^([A-H]\d{1,2})\s*·\s*(.+)$")
SECTION_RE = re.compile(r"<!-- SECTION:([A-Z_]+):BEGIN -->\n?(.*?)\n?<!-- SECTION:\1:END -->", re.S)
LIST_RE = {k: re.compile(rf"<!-- {k}:BEGIN -->\n?(.*?)\n?<!-- {k}:END -->", re.S) for k in ("AC", "DOD")}
CHECK_ITEM = re.compile(r"^- \[([ xX])\] (?:#\d+ )?(.*)$")
REQS_LINE = re.compile(r"^Требования(?: БФТ)?\s*:\s*(.*)$")
STEP_RE = re.compile(r"^\d+\.\s+\S")
META_OPEN = re.compile(r"^<!--\s*(bft-map|bft-story)\s*$")
MERMAID = re.compile(r"```mermaid\n(.*?)\n```", re.S)


@dataclass
class Item:
    """Значение параметра карточки: текст и ссылки на другие карточки."""
    text: str
    refs: list[str]


@dataclass
class Doc:
    id: str
    title: str
    path: Path
    rel: str
    meta: dict
    body: str
    off: int        # строк файла до тела


@dataclass
class BTask:
    id: str
    title: str
    path: Path
    rel: str
    fm: dict
    off: int                  # строка, с которой начинается описание
    desc: str = ""
    notes: str = ""
    ac: list = field(default_factory=list)       # [(сделано, текст)]
    labels: list = field(default_factory=list)
    parent: str = ""
    stage: str = ""
    layer: str = ""
    team: str = ""            # ID команды или «?»
    cand: str = ""
    kind: str = ""
    why: str = ""
    reqs: list = field(default_factory=list)
    lead: str = ""
    sections: dict = field(default_factory=dict)  # {раздел: (строка, текст)}
    params: dict = field(default_factory=dict)    # {in|ctl|out|mech: [Item]}
    mermaid: str = ""                             # блок BPMN в файле
    user_story: str = ""
    job_stories: list = field(default_factory=list)
    proc: list = field(default_factory=list)      # шаги процесса: {t: task|xor, …}

    @property
    def status(self) -> str:
        return self.fm.get("status", "")

    @property
    def refs(self) -> list:
        return self.fm.get("references") or []

    @property
    def docs(self) -> list:
        return self.fm.get("documentation") or []

    @property
    def ordinal(self) -> float:
        try:
            return float(self.fm.get("ordinal", "") or 1e9)
        except ValueError:
            return 1e9


@dataclass
class Team:
    id: str
    name: str
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
        return self.answer.strip() in bb.EMPTY


@dataclass
class Project:
    root: Path
    bdir: Path | None = None
    prefix: str = "BP"
    meta: dict = field(default_factory=dict)
    title: str = ""
    map_doc: Doc | None = None
    story_doc: Doc | None = None
    story: bs.Story | None = None
    teams: list[Team] = field(default_factory=list)
    questions: list[Question] = field(default_factory=list)
    docs: dict = field(default_factory=dict)       # {doc-id: Doc}
    screens: dict = field(default_factory=dict)    # {ID экрана: bsn.ScreenDoc}
    tasks: list[BTask] = field(default_factory=list)   # «Что делаем»
    cards: list[BTask] = field(default_factory=list)   # «Как это работает»
    other: int = 0                                     # задачи проекта вне карты
    issues: list[bb.Issue] = field(default_factory=list)

    def err(self, rel: str, line: int, code: str, msg: str) -> None:
        self.issues.append(bb.Issue(line, "ERROR", code, msg, rel))

    def warn(self, rel: str, line: int, code: str, msg: str) -> None:
        self.issues.append(bb.Issue(line, "WARN", code, msg, rel))

    @property
    def errors(self) -> list[bb.Issue]:
        return [i for i in self.issues if i.level == "ERROR"]

    def task(self, tid: str) -> BTask | None:
        return next((t for t in self.tasks + self.cards if t.id == tid), None)

    @property
    def id_re(self) -> re.Pattern:
        return re.compile(rf"\b{re.escape(self.prefix)}-\d+(?:\.\d+)*\b")

    def links(self) -> list[tuple[str, str, str]]:
        """Стрелки между карточками: (откуда, куда, что передаётся) — из ссылок в параметрах."""
        ids = {c.id for c in self.cards}
        out, seen = [], set()
        for c in self.cards:
            for key in ("in", "ctl", "out"):
                for it in c.params.get(key, []):
                    for r in it.refs:
                        if r not in ids or r == c.id:
                            continue
                        a, b = (c.id, r) if key == "out" else (r, c.id)
                        if (a, b) not in seen:
                            seen.add((a, b))
                            out.append((a, b, it.text))
        return out


# --- frontmatter Backlog.md: подмножество YAML, которое пишет CLI ---------------------------------

def _scalar(v: str):
    v = v.strip()
    if v in ("", "~", "null"):
        return ""
    if v == "[]":
        return []
    if len(v) >= 2 and v[0] == v[-1] == "'":
        return v[1:-1].replace("''", "'")
    if len(v) >= 2 and v[0] == v[-1] == '"':
        try:
            return json.loads(v)
        except ValueError:
            return v[1:-1]
    if v.startswith("[") and v.endswith("]"):
        return [_scalar(x) for x in re.findall(r"""'(?:[^']|'')*'|"(?:[^"\\]|\\.)*"|[^,\s][^,]*""", v[1:-1])]
    return v


def yaml_front(text: str) -> tuple[dict | None, int]:
    """(ключи, число строк frontmatter вместе с ---). Не YAML-frontmatter — (None, 0)."""
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return None, 0
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        return None, 0
    out: dict = {}
    i, body = 0, lines[1:end]
    while i < len(body):
        ln = body[i]
        m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", ln)
        if not m:
            i += 1
            continue
        key, rest = m.group(1), m.group(2).strip()
        i += 1
        if rest in (">", ">-", ">+", "|", "|-", "|+"):
            block = []
            while i < len(body) and (body[i].startswith(" ") or not body[i].strip()):
                block.append(body[i].strip())
                i += 1
            out[key] = (" " if rest[0] == ">" else "\n").join(block).strip()
        elif rest == "":
            items = []
            while i < len(body) and re.match(r"^\s*- ", body[i]):
                items.append(_scalar(re.sub(r"^\s*- ", "", body[i])))
                i += 1
            out[key] = items
        else:
            out[key] = _scalar(rest)
    return out, end + 1


# --- разбор ---------------------------------------------------------------------------------------

def find_backlog(root: Path) -> Path | None:
    cfg = root / "backlog.config.yml"
    if cfg.is_file():
        m = re.search(r"^backlog_directory:\s*[\"']?([^\"'\n]+)", cfg.read_text(encoding="utf-8"), re.M)
        if m and (root / m.group(1).strip()).is_dir():
            return root / m.group(1).strip()
    for name in ("backlog", ".backlog"):
        if (root / name / "config.yml").is_file():
            return root / name
    return None


def _meta_comment(body: str, kind: str) -> tuple[dict, str] | None:
    """Метаданные в HTML-комментарии <!-- bft-map … --> в начале тела: в Backlog.md они не видны."""
    lines = body.split("\n")
    k = next((i for i, ln in enumerate(lines) if ln.strip()), None)
    if k is None or not META_OPEN.match(lines[k].strip()) or lines[k].strip()[4:].strip() != kind:
        return None
    end = next((i for i in range(k + 1, len(lines)) if lines[i].strip() == "-->"), None)
    if end is None:
        return None
    meta = {}
    for ln in lines[k + 1:end]:
        if ":" in ln:
            a, _, b = ln.partition(":")
            meta[a.strip()] = b.strip().strip("\"'")
    # тот же текст с frontmatter вместо комментария — номера строк совпадают
    as_front = "\n".join(lines[:k] + ["---"] + lines[k + 1:end] + ["---"] + lines[end + 1:])
    return meta, as_front


def _read_doc(pr: Project, f: Path) -> Doc | None:
    rel = f.relative_to(pr.root).as_posix()
    text = f.read_text(encoding="utf-8")
    fm, off = yaml_front(text)
    if fm is None or not fm.get("id") or not fm.get("title"):
        pr.err(rel, 1, "BL005", "документ без frontmatter Backlog.md (id, title) — создавай через `backlog doc create`")
        return None
    return Doc(str(fm["id"]), str(fm["title"]), f, rel, fm, "\n".join(text.split("\n")[off:]), off)


def _subsections(text: str, first: int) -> tuple[list[str], dict, list[tuple[int, str]]]:
    """Текст описания: (строки до первого ###, {раздел: (строка, текст)}, порядок [(строка, раздел)])."""
    pre, secs, order, cur, buf, start = [], {}, [], None, [], 0
    for n, ln in enumerate(text.split("\n"), start=first):
        if ln.startswith("### "):
            if cur is not None:
                secs[cur] = (start, "\n".join(buf).strip())
            cur, buf, start = ln[4:].strip(), [], n
            order.append((n, cur))
        elif cur is None:
            pre.append(ln)
        else:
            buf.append(ln)
    if cur is not None:
        secs[cur] = (start, "\n".join(buf).strip())
    return pre, secs, order


def split_items(raw: str) -> list[str]:
    """Значения через «;», точка с запятой внутри скобок значение не делит."""
    out, buf, depth = [], "", 0
    for ch in raw:
        depth += ch in "(«" and 1 or 0
        depth -= ch in ")»" and 1 or 0
        if ch == ";" and depth <= 0:
            out.append(buf)
            buf = ""
        else:
            buf += ch
    out.append(buf)
    return [x.strip() for x in out if x.strip()]


def parse_params(pr: Project, t: BTask, line: int, text: str) -> None:
    ref_group = re.compile(rf"\s*\(\s*(?:[←→]\s*)?{re.escape(pr.prefix)}-\d+(?:\.\d+)*(?:\s*,\s*(?:[←→]\s*)?{re.escape(pr.prefix)}-\d+(?:\.\d+)*)*\s*\)")
    for n, raw in enumerate(text.split("\n"), start=line + 1):
        ln = raw.strip()
        if not ln:
            continue
        m = re.match(r"^[-*]\s*(?:\*\*)?([А-Яа-яЁё]+)\s*:\s*(?:\*\*)?\s*(.*)$", ln)
        key = PARAM_KEYS.get(m.group(1).lower()) if m else None
        if not key:
            pr.err(t.rel, n, "BL009", f"{t.id}: «Параметры» — строки `- **Вход:** …`, `- **Управление:** …`, `- **Выход:** …`, `- **Механизм:** …`, а не «{ln[:40]}»")
            continue
        for v in split_items(m.group(2).replace("**", "")):
            refs = pr.id_re.findall(v)
            txt = ref_group.sub("", v).strip() or v
            t.params.setdefault(key, []).append(Item(txt, refs))


STEP_TASK = re.compile(r"^([^:?→]{1,40}?)\s*:\s*(\S.*)$")
BRANCH = re.compile(r"^(.+?)\s*(?:→|->)\s*(.+)$")


def parse_process(pr: "Project", c: BTask, line: int, text: str) -> None:
    """### Процесс: «- Участник: действие», «- ? вопрос» и под ним «  - ответ → Участник: действие | конец»."""
    err = lambda n, msg: pr.err(c.rel, n, "BL009", f"{c.id}: «Процесс» — {msg}")  # noqa: E731
    gate = None
    for n, raw in enumerate(text.split("\n"), start=line + 1):
        if not raw.strip():
            continue
        m = re.match(r"^(\s*)[-*]\s+(.*)$", raw)
        if not m:
            err(n, f"строка списка «- …», а не «{raw.strip()[:40]}»")
            continue
        sub, body = len(m.group(1)) >= 2, m.group(2).strip()
        if sub:
            bm = BRANCH.match(body)
            if gate is None or not bm:
                err(n, "ветка — под развилкой «- ? вопрос», вида «  - да → Участник: действие» или «  - нет → конец»")
                continue
            label, tail = bm.group(1).strip(), bm.group(2).strip()
            if tail.lower() in ("конец", "end"):
                gate["br"].append({"label": label, "end": True})
                continue
            tm = STEP_TASK.match(tail)
            if not tm:
                err(n, f"ветка «{label}» — «Участник: действие» или «конец»")
                continue
            gate["br"].append({"label": label, "lane": tm.group(1).strip(), "text": tm.group(2).strip()})
            continue
        if body.startswith("?"):
            gate = {"t": "xor", "q": body[1:].strip(), "br": [], "line": n}
            c.proc.append(gate)
            continue
        gate = None
        tm = STEP_TASK.match(body)
        if not tm:
            err(n, f"шаг «Участник: действие», а не «{body[:40]}»")
            continue
        c.proc.append({"t": "task", "lane": tm.group(1).strip(), "text": tm.group(2).strip()})
    for g in [x for x in c.proc if x["t"] == "xor"]:
        if len(g["br"]) < 2:
            err(g["line"], f"у развилки «{g['q']}» нужно хотя бы две ветки")
        g.pop("line", None)
    tasks = [x for x in c.proc if x["t"] == "task"] + [b for g in c.proc if g["t"] == "xor" for b in g["br"] if not b.get("end")]
    if len(tasks) < 2:
        err(line, "хотя бы два шага")
    if len(tasks) > MAX_STEPS:
        err(line, f"{len(tasks)} шагов (больше {MAX_STEPS}) — раздели карточку на две")
    if len(lanes_of(c.proc)) > MAX_LANES:
        err(line, f"участников {len(lanes_of(c.proc))} (больше {MAX_LANES})")


def lanes_of(proc: list) -> list[str]:
    out: list[str] = []
    for x in proc:
        for lane in ([x["lane"]] if x["t"] == "task" else [b["lane"] for b in x["br"] if b.get("lane")]):
            if lane not in out:
                out.append(lane)
    return out


def bpmn_of(c: BTask) -> str:
    """Процесс карточки в mermaid: дорожка — участник, развилка — ромб; тот же процесс — тот же текст."""
    q = lambda s: s.replace('"', "#quot;")  # noqa: E731
    lanes = lanes_of(c.proc)
    lane_nodes: dict[str, list[str]] = {ln: [] for ln in lanes}
    edges: list[str] = []
    node_lines: list[str] = []
    n = 0
    prev: list[tuple[str, str]] = [("S", "")]   # (узел, подпись ребра)
    last_lane = lanes[0] if lanes else ""
    first_lane = last_lane
    ends = 0
    for x in c.proc:
        if x["t"] == "task":
            n += 1
            nid = f"N{n}"
            lane_nodes[x["lane"]].append(f'{nid}["{q(x["text"])}"]')
            edges += [f"  {a} -- {lab} --> {nid}" if lab else f"  {a} --> {nid}" for a, lab in prev]
            prev, last_lane = [(nid, "")], x["lane"]
        else:
            n += 1
            gid = f"G{n}"
            node_lines.append(f'  {gid}{{"{q(x["q"])}"}}')
            edges += [f"  {a} -- {lab} --> {gid}" if lab else f"  {a} --> {gid}" for a, lab in prev]
            prev = []
            for b in x["br"]:
                if b.get("end"):
                    ends += 1
                    node_lines.append(f'  E{ends}((("конец")))')
                    edges.append(f'  {gid} -- {q(b["label"])} --> E{ends}')
                    continue
                n += 1
                nid = f"N{n}"
                lane_nodes[b["lane"]].append(f'{nid}["{q(b["text"])}"]')
                edges.append(f'  {gid} -- {q(b["label"])} --> {nid}')
                prev.append((nid, ""))
                last_lane = b["lane"]
    out = ["```mermaid", "flowchart LR", '  S(("старт"))']
    for i, ln in enumerate(lanes, 1):
        out.append(f'  subgraph L{i}["{q(ln)}"]')
        out += [f"    {x}" for x in lane_nodes[ln]]
        out.append("  end")
    out += node_lines
    if prev:
        out.append('  E((("конец")))')
        edges += [f"  {a} --> E" for a, _ in prev]
    out += edges
    out.append("```")
    del first_lane, last_lane
    return "\n".join(out)


def _read_task(pr: Project, f: Path) -> BTask | None:
    rel = f.relative_to(pr.root).as_posix()
    text = f.read_text(encoding="utf-8")
    fm, off = yaml_front(text)
    if fm is None or not fm.get("id") or not fm.get("title"):
        pr.err(rel, 1, "BL005", "задача без frontmatter Backlog.md (id, title, status) — создавай через `backlog task create`")
        return None
    t = BTask(str(fm["id"]).upper(), str(fm["title"]).strip(), f, rel, fm, 0)
    t.labels = [str(x) for x in (fm.get("labels") or [])]
    t.parent = str(fm.get("parent_task_id") or "").upper()
    sections = {k: v for k, v in SECTION_RE.findall(text)}
    if "DESCRIPTION" in sections:
        t.desc = sections["DESCRIPTION"]
        t.off = text[:text.index("<!-- SECTION:DESCRIPTION:BEGIN -->")].count("\n") + 2
    else:  # файл старого вида: «## Description» без маркеров
        dm = re.search(r"^## Description\n(.*?)(?=^## |\Z)", text, re.S | re.M)
        if dm:
            t.desc = dm.group(1).strip("\n")
            t.off = text[:dm.start(1)].count("\n") + 1
    t.notes = sections.get("NOTES", "").strip()
    am = LIST_RE["AC"].search(text)
    if am:
        for ln in am.group(1).split("\n"):
            cm = CHECK_ITEM.match(ln.strip())
            if cm:
                t.ac.append((cm.group(1) != " ", cm.group(2).strip()))
    return t


def _label(t: BTask, key: str) -> list[str]:
    return [x.split(":", 1)[1].strip() for x in t.labels if x.lower().startswith(key + ":")]


def parse(root: Path) -> Project:
    pr = Project(root=root)
    pr.bdir = find_backlog(root)
    if pr.bdir is None:
        pr.err("", 1, "BL001", "не проект Backlog.md: нет backlog/config.yml — `bft-backlog-init.py` или `backlog init`")
        return pr
    cfg = (pr.bdir / "config.yml").read_text(encoding="utf-8")
    m = re.search(r"^task_prefix:\s*[\"']?([A-Za-z]+)", cfg, re.M)
    pr.prefix = (m.group(1) if m else "task").upper()

    # --- документы: паспорт карты, история, экраны --------------------------------------------
    for f in sorted((pr.bdir / "docs").rglob("*.md")) if (pr.bdir / "docs").is_dir() else []:
        d = _read_doc(pr, f)
        if not d:
            continue
        if d.id in pr.docs:
            pr.err(d.rel, 1, "BL005", f"второй документ с ID {d.id} — `backlog doctor`")
            continue
        pr.docs[d.id] = d
        for kind in ("bft-map", "bft-story"):
            mc = _meta_comment(d.body, kind)
            if mc:
                d.meta = {**d.meta, "_kind": kind}
                if kind == "bft-map":
                    if pr.map_doc:
                        pr.err(d.rel, 1, "BL002", f"второй паспорт карты — уже есть {pr.map_doc.rel}")
                    pr.map_doc, pr.meta = d, mc[0]
                else:
                    if pr.story_doc:
                        pr.err(d.rel, 1, "BL003", f"вторая история — уже есть {pr.story_doc.rel}")
                    pr.story_doc = d
                    pr.story = bs.parse(f, mc[1])
                    for i in pr.story.issues:
                        pr.issues.append(bb.Issue(i.line + d.off, i.level, i.code, i.msg, d.rel))

    if not pr.map_doc:
        pr.err("", 1, "BL002", "нет документа «Карта» с паспортом <!-- bft-map … --> — `bft-backlog-init.py`")
    else:
        md = pr.map_doc
        for key in MAP_META:
            if not pr.meta.get(key):
                pr.err(md.rel, md.off + 1, "BL002", f"паспорт <!-- bft-map -->: нет ключа `{key}`")
        lines = md.body.split("\n")
        h1 = next((ln for ln in lines if ln.startswith("# ")), "")
        pr.title = re.sub(r"^#\s*(Карта\s*[:·—-]\s*)?", "", h1).strip()
        if not h1:
            pr.err(md.rel, md.off + 1, "BL002", "нет заголовка `# Карта: <инициатива>`")
        secs = bb._sections(lines)
        for name, header in (("Команды", TEAMS_HEADER), ("Вопросы", QUESTIONS_HEADER)):
            if name not in secs:
                pr.err(md.rel, md.off + 1, "BL004", f"нет раздела «## {name}»")
                continue
            ln0, body = secs[name]
            found = bb.tables(body, first_lineno=md.off + ln0 + 1)
            if not found:
                if name == "Команды":
                    pr.err(md.rel, md.off + ln0, "BL004", "«Команды»: нет таблицы")
                continue
            hdr, rows = found[0]
            if tuple(hdr) != header:
                pr.err(md.rel, md.off + ln0, "BL004", f"«{name}»: заголовок таблицы — {' | '.join(header)}")
                continue
            for ln, c in rows:
                if len(c) != len(header):
                    pr.err(md.rel, ln, "BL004", f"«{name}»: в строке {len(c)} колонок, нужно {len(header)}")
                    continue
                if name == "Команды":
                    tid = c[0].strip()
                    if not TEAM_RE.match(tid) or any(t.id == tid for t in pr.teams) or not c[1].strip():
                        pr.err(md.rel, ln, "BL004", f"команда: ID — латиница-слаг, уникален, название не пусто — «{tid}»")
                        continue
                    pr.teams.append(Team(tid, c[1].strip(), ln))
                else:
                    qid = bs.norm_question(c[0])
                    if not qid or any(q.id == qid for q in pr.questions):
                        pr.err(md.rel, ln, "BL010", f"вопрос: ID вида В1, уникален — «{c[0]}»")
                        continue
                    pr.questions.append(Question(qid, c[1].strip(), c[2].strip(), c[3].strip().upper(),
                                                 c[4].strip().lower(), c[5].strip(), ln))
    if not pr.story_doc:
        pr.err("", 1, "BL003", "нет документа «История» с <!-- bft-story … --> — `bft-backlog-init.py <epic>-story.md`")
    elif pr.story.errors:
        pr.err(pr.story_doc.rel, 1, "BL003", f"в истории ошибки ({len(pr.story.errors)}) — карта собирается на исправной истории")

    # --- экраны ------------------------------------------------------------------------------------
    sdocs = []
    for d in pr.docs.values():
        if d.meta.get("_kind"):
            continue
        sm = SCREEN_TITLE.match(d.title)
        in_screens = "/docs/screens/" in "/" + d.rel
        if sm:
            sdocs.append(bsn.parse(sm.group(1), d.path, d.body, d.rel, d.off, pr.issues))
        elif in_screens:
            pr.err(d.rel, 2, "SN001", f"документ экрана: заголовок «F3 · Название», а не «{d.title}»")
    if pr.story:
        pr.screens = bsn.check(sdocs, {sc.id for sc in pr.story.screens}, pr.issues)

    # --- задачи --------------------------------------------------------------------------------------
    files = []
    for sub in ("tasks", "completed"):
        if (pr.bdir / sub).is_dir():
            files += sorted((pr.bdir / sub).glob("*.md"))
    raw = [t for t in (_read_task(pr, f) for f in files) if t]
    seen_ids: set[str] = set()
    for t in raw:
        if t.id in seen_ids:
            pr.err(t.rel, 1, "BL005", f"второй файл задачи {t.id} — `backlog doctor`")
            continue
        seen_ids.add(t.id)
        st = _label(t, "stage")
        if not st:
            pr.other += 1
            continue
        t.stage = st[0].upper() if st[0].lower() != FINAL else FINAL
        t.layer = (_label(t, "layer") or [""])[0].lower()
        (pr.cards if _label(t, "layer") else pr.tasks).append(t)
        if len(st) > 1:
            pr.err(t.rel, 1, "BL006", f"{t.id}: меток этапа {len(st)} — одна `stage:<этап>`")
    key = lambda t: (t.ordinal, [int(x) for x in re.findall(r"\d+", t.id)])  # noqa: E731
    pr.tasks.sort(key=key)
    pr.cards.sort(key=key)

    stages = ({s.id for s in pr.story.stages} if pr.story else set()) | {FINAL}
    team_ids = {t.id for t in pr.teams}
    task_ids = {t.id for t in pr.tasks}
    card_ids = {c.id for c in pr.cards}
    for t in pr.tasks:
        _check_task(pr, t, stages, team_ids)
    for c in pr.cards:
        _check_card(pr, c, stages, team_ids, task_ids, card_ids)
    for q in pr.questions:
        if q.where not in task_ids | card_ids:
            pr.err(pr.map_doc.rel, q.line, "BL010", f"{q.id}: «Где» — ID задачи или карточки карты ({pr.prefix}-12, {pr.prefix}-12.1), а не «{q.where}»")
        if q.kind not in Q_TYPES:
            pr.err(pr.map_doc.rel, q.line, "BL010", f"{q.id}: тип «{q.kind}» — вопрос или блокер")
        if not q.to or not q.text:
            pr.err(pr.map_doc.rel, q.line, "BL010", f"{q.id}: нужны «Кому» и «Вопрос»")
    for t in pr.tasks + pr.cards:
        for d in t.docs:
            if re.match(r"^doc-\d+", str(d), re.I) and str(d).split()[0].lower() not in {k.lower() for k in pr.docs}:
                pr.err(t.rel, 1, "BL011", f"{t.id}: документа {d} нет в backlog/docs")
    return pr


def _check_task(pr: Project, t: BTask, stages: set, team_ids: set) -> None:
    rel = t.rel
    if pr.story and t.stage not in stages:
        pr.err(rel, 1, "BL006", f"{t.id}: этап «{t.stage}» — ID этапа истории или `стало` (метка stage:F)")
    if t.parent:
        pr.err(rel, 1, "BL006", f"{t.id}: задача «Что делаем» — без родителя; карточка «Как это работает» — с меткой layer:…")
    kinds = [x for x in t.labels if x.lower() in KINDS]
    if len(kinds) != 1:
        pr.err(rel, 1, "BL006", f"{t.id}: вид — одна метка из {', '.join(KINDS)}")
    t.kind = kinds[0].lower() if kinds else ""
    who = [str(a).lstrip("@") for a in (t.fm.get("assignee") or [])]
    cand = _label(t, "кандидат")
    if len(who) > 1:
        pr.err(rel, 1, "BL006", f"{t.id}: исполнителей {len(who)} — одна команда на задачу")
    if who:
        t.team = who[0]
        if t.team not in team_ids:
            pr.err(rel, 1, "BL006", f"{t.id}: команды @{t.team} нет в «Командах»; не известна — без исполнителя, метки кандидат:<команда>")
    else:
        t.team = "?"
        names = {x.id: x.name for x in pr.teams}
        t.cand = " или ".join(names.get(c, c) for c in cand)
    for c in cand:
        if c not in team_ids:
            pr.err(rel, 1, "BL006", f"{t.id}: кандидата {c} нет в «Командах»")
    pre, secs, order = _subsections(t.desc, t.off)
    t.sections = secs
    why = []
    for ln in pre:
        rm = REQS_LINE.match(ln.strip())
        if rm:
            t.reqs = bb.REQ_RE.findall(rm.group(1))
        else:
            why.append(ln)
    t.why = "\n".join(why).strip()
    if not t.why:
        pr.err(rel, t.off, "BL007", f"{t.id}: описание начинается с «зачем» — вклад задачи в цель, одна-две фразы")
    names = [n for _, n in order]
    for n, name in order:
        if name not in BRIEF:
            pr.err(rel, n, "BL007", f"{t.id}: раздел «{name}» — один из {', '.join(BRIEF)}")
    if names != [s for s in BRIEF if s in names] or len(set(names)) != len(names):
        pr.err(rel, t.off, "BL007", f"{t.id}: разделы по порядку, без повторов: " + " → ".join(BRIEF))
    for s in BRIEF:
        if s in BRIEF_OPTIONAL:
            continue
        if s not in secs:
            pr.err(rel, t.off, "BL007", f"{t.id}: нет раздела `### {s}`")
        elif not secs[s][1]:
            pr.err(rel, secs[s][0], "BL007", f"{t.id}: раздел {s} пустой")
    if "HowToDemo" in secs and sum(bool(STEP_RE.match(x.strip())) for x in secs["HowToDemo"][1].split("\n")) < 2:
        pr.err(rel, secs["HowToDemo"][0], "BL007", f"{t.id}: HowToDemo — нумерованный сценарий хотя бы из двух шагов «1. …»")
    if not t.ac:
        pr.err(rel, 1, "BL007", f"{t.id}: нет критериев приемки (Acceptance Criteria) — `backlog task edit {t.id} --ac …`")


def _check_card(pr: Project, c: BTask, stages: set, team_ids: set, task_ids: set, card_ids: set) -> None:
    rel = c.rel
    if pr.story and c.stage not in stages:
        pr.err(rel, 1, "BL008", f"{c.id}: этап «{c.stage}» — ID этапа истории или `стало`")
    layers = _label(c, "layer")
    if len(layers) != 1 or c.layer not in LAYERS:
        pr.err(rel, 1, "BL008", f"{c.id}: слой — одна метка layer: из {', '.join(LAYERS)}")
    if c.parent not in task_ids:
        pr.err(rel, 1, "BL008", f"{c.id}: родитель — задача «Что делаем» (`backlog task create -p {pr.prefix}-12 …`), а не «{c.parent or '—'}»")
    who = [str(a).lstrip("@") for a in (c.fm.get("assignee") or [])]
    par = pr.task(c.parent)
    c.team = who[0] if who else (par.team if par else "?")
    if who and who[0] not in team_ids:
        pr.err(rel, 1, "BL008", f"{c.id}: команды @{who[0]} нет в «Командах»")
    pre, secs, order = _subsections(c.desc, c.off)
    c.sections = secs
    c.lead = "\n".join(pre).strip()
    names = [n for _, n in order]
    for n, name in order:
        if name not in CARD:
            pr.err(rel, n, "BL009", f"{c.id}: раздел «{name}» — один из {', '.join(CARD)}; ссылки — documentation и references задачи")
    if names != [x for x in CARD if x in names] or len(set(names)) != len(names):
        pr.err(rel, c.off, "BL009", f"{c.id}: разделы по порядку, без повторов: " + " → ".join(CARD))
    for name in CARD_REQUIRED:
        if name not in secs or not secs[name][1].strip():
            pr.err(rel, secs.get(name, (c.off,))[0], "BL009", f"{c.id}: нет раздела `### {name}`")
    if "UserStory" in secs:
        c.user_story = secs["UserStory"][1].strip()
        if c.user_story and not re.match(r"^Как .+,\s*я хочу .+,\s*чтобы .+", c.user_story.replace("**", ""), re.S):
            pr.warn(rel, secs["UserStory"][0], "BL030", f"{c.id}: UserStory — «Как <роль>, я хочу <действие>, чтобы <ценность>»")
    if "JobStory" in secs:
        c.job_stories = [re.sub(r"^[-*]\s+", "", x.strip()) for x in secs["JobStory"][1].split("\n") if re.match(r"^\s*[-*]\s+\S", x)]
        if secs["JobStory"][1].strip() and not c.job_stories:
            pr.err(rel, secs["JobStory"][0], "BL009", f"{c.id}: JobStory — список «- Когда …, хочу …, чтобы …»")
        for js in c.job_stories:
            if not re.match(r"^Когда .+,\s*хочу .+,\s*чтобы .+", js.replace("**", "")):
                pr.warn(rel, secs["JobStory"][0], "BL030", f"{c.id}: JobStory «{js[:40]}…» — «Когда …, хочу …, чтобы …»")
    if "Параметры" in secs:
        parse_params(pr, c, *secs["Параметры"])
        if not c.params.get("out"):
            pr.err(rel, secs["Параметры"][0], "BL009", f"{c.id}: у функции нет выхода — `- **Выход:** …`")
    if "Процесс" in secs:
        parse_process(pr, c, *secs["Процесс"])
    if "HowToDemo" in secs and sum(bool(STEP_RE.match(x.strip())) for x in secs["HowToDemo"][1].split("\n")) < 2:
        pr.err(rel, secs["HowToDemo"][0], "BL009", f"{c.id}: HowToDemo — хотя бы два шага «1. …»")
    if "BPMN" in secs:
        mm = MERMAID.search(secs["BPMN"][1])
        c.mermaid = f"```mermaid\n{mm.group(1)}\n```" if mm else secs["BPMN"][1]
    for key, items in c.params.items():
        for it in items:
            for r in it.refs:
                if r == c.id or r not in card_ids:
                    pr.err(rel, secs["Параметры"][0], "BL009", f"{c.id}: ссылка {r} в «{PARAM_NAME[key]}» — на другую карточку «Как это работает»")


def sync_schema(pr: Project, write: bool) -> list[BTask]:
    """BPMN карточек — mermaid из «Процесса». Возвращает карточки, где блок устарел; write — переписать.
    Прежний блок `### IDEF0` при переписывании убирается: схему функции заменила схема процесса."""
    stale = []
    for c in pr.cards:
        if not c.proc:
            continue
        want = bpmn_of(c)
        if c.mermaid.strip() == want and "### IDEF0" not in c.desc:
            continue
        stale.append(c)
        if not write:
            continue
        text = c.path.read_text(encoding="utf-8")
        a = text.index("<!-- SECTION:DESCRIPTION:BEGIN -->") + len("<!-- SECTION:DESCRIPTION:BEGIN -->\n")
        b = text.index("<!-- SECTION:DESCRIPTION:END -->")
        desc = re.sub(r"^### IDEF0\n.*?(?=^### |\Z)", "", text[a:b], flags=re.S | re.M)
        block = f"### BPMN\n{want}\n"
        if re.search(r"^### BPMN\n", desc, re.M):
            desc = re.sub(r"^### BPMN\n.*?(?=^### |\Z)", lambda _: block + "\n", desc, count=1, flags=re.S | re.M)
        elif re.search(r"^### HowToDemo\n", desc, re.M):
            desc = re.sub(r"^### HowToDemo\n", lambda _: block + "\n### HowToDemo\n", desc, count=1, flags=re.M)
        else:
            desc = desc.rstrip("\n") + "\n\n" + block
        c.path.write_text(text[:a] + desc.rstrip("\n") + "\n" + text[b:], encoding="utf-8")
        c.mermaid = want
    return stale
