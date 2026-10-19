#!/usr/bin/env python3
"""backlog — встроенный CLI проекта Backlog.md: только Python 3 и стандартная библиотека.

Проект карты должен работать в любом харнессе без установки: агент ведёт задачи и документы этой
командой, файлы — в формате Backlog.md 1.54 (https://github.com/MrLesk/Backlog.md, MIT). Установлен
npm-пакет `backlog.md` — его `backlog` работает с теми же файлами; этот CLI — его подмножество
для работы агента:

    backlog task create "Название" [-d ОПИСАНИЕ] [-a @команда] [-s СТАТУС] [-l метка,метка] [-p BP-12]
                        [--ac КРИТЕРИЙ]... [--dod ПУНКТ]... [--no-dod-defaults] [--dep BP-3] [--ref ССЫЛКА]...
                        [--doc doc-4]... [--notes ТЕКСТ] [--plan ТЕКСТ] [--ordinal N]
    backlog task edit BP-12 [-t НАЗВАНИЕ] [-d ОПИСАНИЕ] [-a @команда] [-s СТАТУС] [-l метки | --add-label | --remove-label]
                        [--ac КРИТЕРИЙ]... [--check-ac N] [--uncheck-ac N] [--remove-ac N] [--clear-ac]
                        [--ref ССЫЛКА | --add-ref | --remove-ref | --clear-refs] [--doc ДОКУМЕНТ]... [--dep BP-3]
                        [--notes ТЕКСТ | --append-notes ТЕКСТ] [--plan ТЕКСТ] [--final-summary ТЕКСТ]
                        [--comment ТЕКСТ [--comment-author @кто]]
    backlog task view BP-12 [--plain | --json]      backlog task BP-12
    backlog task list [-s СТАТУС] [-l МЕТКИ] [--parent BP-12] [--search ТЕКСТ] [--plain | --json]
    backlog doc create "Название" [-t specification] [-p screens]
    backlog doc update doc-4 [--content ТЕКСТ] [--title НАЗВАНИЕ] [--tags a,b] [-t ТИП]
    backlog doc view doc-4                           backlog doc list
    backlog search ТЕКСТ                             backlog board
    backlog instructions [overview | task-creation | task-execution | task-finalization]

Многострочный текст — настоящими переводами строк: в bash `-d $'строка 1\\nстрока 2'`.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import signal
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import bft_backlog as bl  # noqa: E402  (разбор frontmatter и разделов — общий с линтером карты)

FM_ORDER = ("id", "title", "status", "assignee", "reporter", "created_date", "updated_date", "labels", "milestone",
            "dependencies", "references", "documentation", "modified_files", "parent_task_id", "priority", "type",
            "ordinal", "due_date")
LISTS = {"assignee", "labels", "dependencies", "references", "documentation", "modified_files", "tags"}
SECTIONS = (("DESCRIPTION", "Description"), ("PLAN", "Implementation Plan"), ("NOTES", "Implementation Notes"),
            ("FINAL_SUMMARY", "Final Summary"))
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}")


class Fail(Exception):
    pass


# --- проект --------------------------------------------------------------------------------------

def project_dir() -> Path:
    cur = Path.cwd().resolve()
    for p in [cur, *cur.parents]:
        if bl.find_backlog(p):
            return p
    raise Fail("не проект Backlog.md: нет backlog/config.yml (запусти из папки проекта)")


def config(bdir: Path) -> dict:
    cfg, _ = bl.yaml_front("---\n" + (bdir / "config.yml").read_text(encoding="utf-8") + "\n---\n")
    return cfg or {}


def now() -> str:
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M")


def slug(title: str) -> str:
    s = re.sub(r"[:;,'\"?!/\\()\[\]{}*<>|#%&+=`~^$@]", "", title)
    s = re.sub(r"\s+", "-", s.strip())
    out = ""
    for ch in s:  # имя файла короче 255 байт и на кириллице
        if len((out + ch).encode("utf-8")) > 180:
            break
        out += ch
    return out.strip("-") or "task"


# --- YAML: как пишет Backlog.md -------------------------------------------------------------------

def yq(v) -> str:
    s = str(v)
    plain = (s and s == s.strip() and not re.match(r"^[-?:,\[\]{}#&*!|>'\"%@`.]", s) and ": " not in s and " #" not in s
             and not s.endswith(":") and not DATE_RE.match(s) and not re.fullmatch(r"[-+]?\d+(\.\d+)?", s)
             and s.lower() not in ("true", "false", "null", "yes", "no", "~") and "\n" not in s)
    return s if plain else "'" + s.replace("'", "''") + "'"


def dump_front(fm: dict) -> str:
    keys = [k for k in FM_ORDER if k in fm] + [k for k in fm if k not in FM_ORDER]
    out = ["---"]
    for k in keys:
        v = fm[k]
        if k in LISTS or isinstance(v, list):
            items = [x for x in (v or []) if str(x) != ""]
            out.append(f"{k}: []" if not items else f"{k}:\n" + "\n".join(f"  - {yq(x)}" for x in items))
        elif k == "ordinal" and str(v).strip().lstrip("-").isdigit():
            out.append(f"{k}: {int(v)}")
        elif v in ("", None):
            continue
        else:
            out.append(f"{k}: {yq(v)}")
    out.append("---")
    return "\n".join(out) + "\n"


# --- задачи ---------------------------------------------------------------------------------------

class Task:
    def __init__(self, path: Path | None, fm: dict, text: str = ""):
        self.path, self.fm = path, fm
        sec = dict(bl.SECTION_RE.findall(text))
        self.sections = {k: sec.get(k, "").strip("\n") for k, _ in SECTIONS}
        self.ac = self._checks(text, "AC")
        self.dod = self._checks(text, "DOD")
        cm = re.search(r"<!-- COMMENTS:BEGIN -->\n?(.*?)\n?<!-- COMMENTS:END -->", text, re.S)
        self.comments = cm.group(1) if cm else ""
        if not sec.get("DESCRIPTION"):  # файл без маркеров
            dm = re.search(r"^## Description\n(.*?)(?=^## |\Z)", text, re.S | re.M)
            if dm:
                self.sections["DESCRIPTION"] = dm.group(1).strip("\n")

    @staticmethod
    def _checks(text: str, key: str) -> list:
        m = bl.LIST_RE[key].search(text)
        out = []
        for ln in (m.group(1).split("\n") if m else []):
            cm = bl.CHECK_ITEM.match(ln.strip())
            if cm:
                out.append([cm.group(1) != " ", cm.group(2).strip()])
        return out

    @property
    def id(self) -> str:
        return str(self.fm.get("id", "")).upper()

    @property
    def title(self) -> str:
        return str(self.fm.get("title", ""))

    def render(self) -> str:
        body = []
        for key, name in SECTIONS[:1]:
            if self.sections[key].strip():
                body += [f"## {name}", "", f"<!-- SECTION:{key}:BEGIN -->", self.sections[key], f"<!-- SECTION:{key}:END -->", ""]
        for key, name, items in (("AC", "Acceptance Criteria", self.ac), ("DOD", "Definition of Done", self.dod)):
            if items:
                body += [f"## {name}", f"<!-- {key}:BEGIN -->"] + [f"- [{'x' if d else ' '}] #{i} {t}" for i, (d, t) in enumerate(items, 1)] + [f"<!-- {key}:END -->", ""]
        for key, name in SECTIONS[1:]:
            if self.sections[key].strip():
                body += [f"## {name}", "", f"<!-- SECTION:{key}:BEGIN -->", self.sections[key], f"<!-- SECTION:{key}:END -->", ""]
        if self.comments.strip():
            body += ["## Comments", "", "<!-- COMMENTS:BEGIN -->", self.comments, "<!-- COMMENTS:END -->", ""]
        return dump_front(self.fm) + ("\n" + "\n".join(body).rstrip("\n") + "\n" if body else "")


def load_tasks(bdir: Path, archived: bool = False) -> list[Task]:
    subs = ["tasks", "completed"] + (["archive/tasks", "drafts"] if archived else [])
    out = []
    for sub in subs:
        for f in sorted((bdir / sub).glob("*.md")) if (bdir / sub).is_dir() else []:
            text = f.read_text(encoding="utf-8")
            fm, _ = bl.yaml_front(text)
            if fm and fm.get("id"):
                out.append(Task(f, fm, text))
    return out


def find_task(bdir: Path, tid: str) -> Task:
    tid = tid.upper()
    for t in load_tasks(bdir):
        if t.id == tid:
            return t
    raise Fail(f"задачи {tid} нет — `backlog task list --plain`")


def save(t: Task, bdir: Path, prefix: str) -> None:
    name = f"{t.id.lower()} - {slug(t.title)}.md"
    target = (t.path.parent if t.path else bdir / "tasks") / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(t.render(), encoding="utf-8")
    if t.path and t.path != target and t.path.exists():
        t.path.unlink()
    t.path = target


def split_list(values) -> list[str]:
    out = []
    for v in values or []:
        out += [x.strip() for x in str(v).split(",") if x.strip()]
    return out


def who(values) -> list[str]:
    return ["@" + x.lstrip("@") for x in split_list(values)]


def next_id(tasks: list[Task], prefix: str, parent: str = "") -> str:
    if parent:
        nums = [int(t.id.rsplit(".", 1)[1]) for t in tasks if re.fullmatch(re.escape(parent) + r"\.\d+", t.id)]
        return f"{parent}.{max(nums, default=0) + 1}"
    nums = [int(m.group(1)) for t in tasks for m in [re.fullmatch(re.escape(prefix) + r"-(\d+)(?:\.\d+)*", t.id)] if m]
    return f"{prefix}-{max(nums, default=0) + 1}"


def cmd_task_create(a, root: Path, bdir: Path, cfg: dict, prefix: str) -> None:
    tasks = load_tasks(bdir, archived=True)
    parent = (a.parent or "").upper()
    if parent and not any(t.id == parent for t in tasks):
        raise Fail(f"родителя {parent} нет — `-p` принимает ID задачи, не milestone")
    fm = {"id": next_id(tasks, prefix, parent), "title": a.title, "status": a.status or cfg.get("default_status") or "To Do",
          "assignee": who(a.assignee), "created_date": now(), "labels": split_list(a.labels),
          "dependencies": [x.upper() for x in split_list(a.dep)]}
    if a.milestone:
        fm["milestone"] = a.milestone
    if a.ref:
        fm["references"] = split_list(a.ref)
    if a.doc:
        fm["documentation"] = split_list(a.doc)
    if parent:
        fm["parent_task_id"] = parent
    ords = [float(t.fm.get("ordinal")) for t in tasks if str(t.fm.get("ordinal", "")).replace(".", "", 1).isdigit()]
    fm["ordinal"] = int(a.ordinal) if a.ordinal is not None else int(max(ords, default=0)) + 1000
    t = Task(None, fm)
    t.sections["DESCRIPTION"] = a.description or ""
    t.sections["PLAN"] = a.plan or ""
    t.sections["NOTES"] = a.notes or ""
    t.ac = [[False, x] for x in a.ac or []]
    dod = [] if a.no_dod_defaults else [str(x) for x in (cfg.get("definition_of_done") or [])]
    t.dod = [[False, x] for x in dod + (a.dod or [])]
    save(t, bdir, prefix)
    print(f"Created task {t.id}\nFile: {t.path.relative_to(root)}")


def _index(items: list, n: str, what: str) -> int:
    i = int(n) - 1
    if not 0 <= i < len(items):
        raise Fail(f"{what} #{n} нет — их {len(items)}")
    return i


def cmd_task_edit(a, root: Path, bdir: Path, cfg: dict, prefix: str) -> None:
    t = find_task(bdir, a.id)
    fm = t.fm
    if a.title:
        fm["title"] = a.title
    if a.description is not None:
        t.sections["DESCRIPTION"] = a.description
    if a.assignee is not None:
        fm["assignee"] = who(a.assignee)
    if a.status:
        fm["status"] = a.status
    labels = list(fm.get("labels") or [])
    if a.clear_labels:
        labels = []
    if a.label is not None:
        labels = split_list(a.label)
    labels += [x for x in split_list(a.add_label) if x not in labels]
    labels = [x for x in labels if x not in split_list(a.remove_label)]
    fm["labels"] = labels
    if a.milestone:
        fm["milestone"] = a.milestone
    if a.clear_milestone:
        fm.pop("milestone", None)
    if a.ordinal is not None:
        fm["ordinal"] = int(a.ordinal)
    if a.clear_deps:
        fm["dependencies"] = []
    if a.dep:
        fm["dependencies"] = [x.upper() for x in split_list(a.dep)]
    refs = list(fm.get("references") or [])
    if a.clear_refs:
        refs = []
    if a.ref is not None:
        refs = split_list(a.ref)
    refs += [x for x in split_list(a.add_ref) if x not in refs]
    refs = [x for x in refs if x not in split_list(a.remove_ref)]
    if refs or "references" in fm:
        fm["references"] = refs
    if a.doc:
        fm["documentation"] = split_list(a.doc)
    for n in sorted(a.remove_ac or [], key=int, reverse=True):
        del t.ac[_index(t.ac, n, "критерия")]
    if a.clear_ac:
        t.ac = []
    if a.acceptance_criteria:
        t.ac = [[False, x] for x in a.acceptance_criteria]
    t.ac += [[False, x] for x in a.ac or []]
    for n in a.check_ac or []:
        t.ac[_index(t.ac, n, "критерия")][0] = True
    for n in a.uncheck_ac or []:
        t.ac[_index(t.ac, n, "критерия")][0] = False
    t.dod += [[False, x] for x in a.dod or []]
    for n in a.check_dod or []:
        t.dod[_index(t.dod, n, "пункта DoD")][0] = True
    for n in a.uncheck_dod or []:
        t.dod[_index(t.dod, n, "пункта DoD")][0] = False
    if a.plan is not None:
        t.sections["PLAN"] = a.plan
    for x in a.append_plan or []:
        t.sections["PLAN"] = (t.sections["PLAN"] + "\n" + x).strip("\n")
    if a.notes is not None:
        t.sections["NOTES"] = a.notes
    for x in a.append_notes or []:
        t.sections["NOTES"] = (t.sections["NOTES"] + "\n" + x).strip("\n")
    if a.final_summary is not None:
        t.sections["FINAL_SUMMARY"] = a.final_summary
    if a.comment:
        block = f"author: {a.comment_author or '@agent'}\ncreated: {now()}\n\n---\n\n{a.comment}\n\n---"
        t.comments = (t.comments.rstrip("\n") + "\n\n" + block).strip("\n") if t.comments.strip() else block
    fm["updated_date"] = now()
    save(t, bdir, prefix)
    print(f"Updated task {t.id}\nFile: {t.path.relative_to(root)}")


def as_json(t: Task, root: Path) -> dict:
    fm = t.fm
    return {"id": t.id, "title": t.title, "status": fm.get("status", ""), "assignees": fm.get("assignee") or [],
            "labels": fm.get("labels") or [], "milestone": fm.get("milestone") or None,
            "parentTaskId": fm.get("parent_task_id") or None, "dependencies": fm.get("dependencies") or [],
            "references": fm.get("references") or [], "documentation": fm.get("documentation") or [],
            "ordinal": fm.get("ordinal"), "createdAt": fm.get("created_date"), "updatedAt": fm.get("updated_date") or None,
            "path": str(t.path.relative_to(root)), "description": t.sections["DESCRIPTION"],
            "acceptanceCriteria": [{"index": i, "checked": d, "text": x} for i, (d, x) in enumerate(t.ac, 1)],
            "definitionOfDone": [{"index": i, "checked": d, "text": x} for i, (d, x) in enumerate(t.dod, 1)],
            "implementationPlan": t.sections["PLAN"], "implementationNotes": t.sections["NOTES"],
            "finalSummary": t.sections["FINAL_SUMMARY"]}


def cmd_task_view(a, root: Path, bdir: Path, *_):
    t = find_task(bdir, a.id)
    if a.json:
        print(json.dumps({"schemaVersion": 1, "kind": "task-view", "task": as_json(t, root)}, ensure_ascii=False, indent=2))
        return
    fm, line = t.fm, "-" * 50
    out = [f"File: {t.path.relative_to(root)}", "", f"Task {t.id} - {t.title}", "=" * 50, "", f"Status: {fm.get('status', '')}"]
    for k, name in (("assignee", "Assignee"), ("labels", "Labels"), ("milestone", "Milestone"), ("dependencies", "Dependencies"),
                    ("references", "References"), ("documentation", "Documentation"), ("parent_task_id", "Parent")):
        v = fm.get(k)
        if v:
            out.append(f"{name}: {', '.join(map(str, v)) if isinstance(v, list) else v}")
    out.append(f"Created: {fm.get('created_date', '')}")
    out += ["", "Description:", line, t.sections["DESCRIPTION"] or "No description provided"]
    for name, items in (("Acceptance Criteria", t.ac), ("Definition of Done", t.dod)):
        if items:
            out += ["", f"{name}:", line] + [f"- [{'x' if d else ' '}] #{i} {x}" for i, (d, x) in enumerate(items, 1)]
    for key, name in SECTIONS[1:]:
        if t.sections[key]:
            out += ["", f"{name}:", line, t.sections[key]]
    if t.comments.strip():
        out += ["", "Comments:", line, t.comments]
    kids = [k for k in load_tasks(bdir) if str(k.fm.get("parent_task_id", "")).upper() == t.id]
    if kids:
        out += ["", "Subtasks:", line] + [f"  {k.id} - {k.title} [{k.fm.get('status', '')}]" for k in kids]
    print("\n".join(out))


def _order(t: Task):
    try:
        o = float(t.fm.get("ordinal") or 1e9)
    except ValueError:
        o = 1e9
    return (o, [int(x) for x in re.findall(r"\d+", t.id)])


def cmd_task_list(a, root: Path, bdir: Path, cfg: dict, *_):
    tasks = load_tasks(bdir)
    if a.status:
        tasks = [t for t in tasks if str(t.fm.get("status", "")).lower() == a.status.lower()]
    if a.labels:
        want = set(split_list([a.labels]))
        tasks = [t for t in tasks if want & set(map(str, t.fm.get("labels") or []))]
    if a.parent:
        tasks = [t for t in tasks if str(t.fm.get("parent_task_id", "")).upper() == a.parent.upper()]
    if a.search:
        q = a.search.lower()
        tasks = [t for t in tasks if q in (t.title + "\n" + t.sections["DESCRIPTION"]).lower()]
    tasks.sort(key=_order)
    if a.json:
        print(json.dumps({"schemaVersion": 1, "kind": "task-list", "tasks": [as_json(t, root) for t in tasks]}, ensure_ascii=False, indent=2))
        return
    statuses = [str(s) for s in (cfg.get("statuses") or ["To Do", "In Progress", "Done"])]
    statuses += sorted({str(t.fm.get("status", "")) for t in tasks} - set(statuses))
    for s in statuses:
        group = [t for t in tasks if str(t.fm.get("status", "")) == s]
        if group:
            print(f"{s}:")
            for t in group:
                ac = f" (ac: {sum(d for d, _ in t.ac)}/{len(t.ac)})" if t.ac else ""
                print(f"  {t.id} - {t.title}{ac}")
            print()


def cmd_board(a, root: Path, bdir: Path, cfg: dict, *_):
    tasks = sorted(load_tasks(bdir), key=_order)
    statuses = [str(s) for s in (cfg.get("statuses") or ["To Do", "In Progress", "Done"])]
    print(f"# Kanban Board · {cfg.get('project_name', '')}\n")
    for s in statuses:
        group = [t for t in tasks if str(t.fm.get("status", "")) == s]
        print(f"## {s} · {len(group)}")
        for t in group:
            pre = "  └─ " if t.fm.get("parent_task_id") else "- "
            lab = " ".join("#" + str(x) for x in t.fm.get("labels") or [])
            print(f"{pre}{t.id} — {t.title} {' '.join(t.fm.get('assignee') or [])} {lab}".rstrip())
        print()


# --- документы ------------------------------------------------------------------------------------

def load_docs(bdir: Path) -> list[tuple[Path, dict, str]]:
    out = []
    for f in sorted((bdir / "docs").rglob("*.md")) if (bdir / "docs").is_dir() else []:
        text = f.read_text(encoding="utf-8")
        fm, off = bl.yaml_front(text)
        if fm and fm.get("id"):
            out.append((f, fm, "\n".join(text.split("\n")[off:])))
    return out


def find_doc(bdir: Path, did: str):
    for f, fm, body in load_docs(bdir):
        if str(fm["id"]).lower() == did.lower():
            return f, fm, body
    raise Fail(f"документа {did} нет — `backlog doc list`")


def cmd_doc_create(a, root: Path, bdir: Path, *_):
    if a.path and (Path(a.path).is_absolute() or ".." in Path(a.path).parts):
        raise Fail("путь документа — внутри backlog/docs, без .. и абсолютных путей")
    nums = [int(m.group(1)) for _, fm, _ in load_docs(bdir) for m in [re.fullmatch(r"doc-(\d+)", str(fm["id"]))] if m]
    did = f"doc-{max(nums, default=0) + 1}"
    fm = {"id": did, "title": a.title, "type": a.type or "other", "created_date": now()}
    f = bdir / "docs" / (a.path or "") / f"{did} - {slug(a.title)}.md"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(dump_front(fm), encoding="utf-8")
    print(f"Created document {did}\nPath: {f.relative_to(root)}")


def cmd_doc_update(a, root: Path, bdir: Path, *_):
    f, fm, body = find_doc(bdir, a.id)
    if a.title:
        fm["title"] = a.title
    if a.type:
        fm["type"] = a.type
    if a.tags is not None:
        fm["tags"] = split_list(a.tags)
    fm["updated_date"] = now()
    order = ["id", "title", "type", "created_date", "updated_date", "tags"]
    fm = {k: fm[k] for k in order + [k for k in fm if k not in order] if k in fm}
    content = a.content if a.content is not None else body
    f.write_text(dump_front(fm) + content.rstrip("\n") + "\n" if content.strip() else dump_front(fm), encoding="utf-8")
    print(f"Updated document {fm['id']}\nPath: {f.relative_to(root)}")


def cmd_doc_view(a, root: Path, bdir: Path, *_):
    f, fm, body = find_doc(bdir, a.id)
    print(f"File: {f.relative_to(root)}\n\n{fm['id']} — {fm['title']}\n{'=' * 50}\n{body.strip()}")


def cmd_doc_list(a, root: Path, bdir: Path, *_):
    for f, fm, _ in load_docs(bdir):
        print(f"{fm['id']} - {fm['title']}  ({f.relative_to(bdir / 'docs').parent.as_posix().replace('.', '') or '/'})")


def cmd_search(a, root: Path, bdir: Path, *_):
    q = a.query.lower()
    for t in sorted(load_tasks(bdir), key=_order):
        if q in (t.title + "\n" + "\n".join(t.sections.values())).lower():
            print(f"task  {t.id} - {t.title}")
    for f, fm, body in load_docs(bdir):
        if q in (str(fm["title"]) + "\n" + body).lower():
            print(f"doc   {fm['id']} - {fm['title']}")


# --- инструкции агенту ----------------------------------------------------------------------------

GUIDES = {
    "overview": """## Backlog.md · обзор (встроенный CLI)

Задачи и документы проекта — markdown-файлы в backlog/. Читай и меняй их только этой командой:
файлы руками не правь — метаданные, связи и история держатся командами.

Найти и прочитать:
- ./backlog.py task list --plain                 задачи по статусам
- ./backlog.py task list -l stage:F --plain      задачи этапа; --parent BP-16 — подзадачи
- ./backlog.py task view BP-16 --plain           задача целиком; --json — для скриптов
- ./backlog.py doc list · ./backlog.py doc view doc-4
- ./backlog.py search "проверка"                 по задачам и документам
- ./backlog.py board                              доска

Перед действием прочитай гайд:
- ./backlog.py instructions task-creation      — перед созданием и делением задач
- ./backlog.py instructions task-execution     — перед планом, статусом, заметками
- ./backlog.py instructions task-finalization  — перед закрытием критериев и статусом Done
""",
    "task-creation": """## Создание задач

1. Сначала поиск: ./backlog.py search "…" и ./backlog.py task list --plain — задача уже может быть.
2. Одна задача — один результат, который проверяется целиком. Общая цель и одна область — подзадачи (-p BP-12);
   разные компоненты — отдельные задачи с зависимостью (--dep BP-21).
3. Название — результат. Описание — зачем задача: проблема или потребность и контекст, которого не видно из кода.
4. Критерии приемки (--ac) — проверяемые, независимые, с краевыми случаями. Не «реализовать функцию».
5. Ссылки — --ref (страницы, файлы), документы — --doc doc-4. Исполнитель — -a @команда.
6. План реализации при создании не пиши: его пишет исполнитель, когда берёт задачу.
7. Текст с обратными кавычками — в одинарных кавычках shell; переводы строк — $'…\\n…'.

  ./backlog.py task create "Название" -d "Зачем" --ac "Критерий" -a @команда -l метка
""",
    "task-execution": """## Выполнение задачи

1. Взял задачу — статус и исполнитель: ./backlog.py task edit BP-12 -s "In Progress" -a @кто
2. Изучи код и данные, запиши план: ./backlog.py task edit BP-12 --plan $'1. …\\n2. …' — согласуй, если просили.
3. По ходу — заметки: ./backlog.py task edit BP-12 --append-notes "что сделано, решения, отклонения".
4. Новые находки вне задачи — отдельная задача, а не расширение этой.
5. Заблокирован — комментарий: ./backlog.py task edit BP-12 --comment "чего не хватает" --comment-author @кто
""",
    "task-finalization": """## Завершение задачи

1. Проверь каждый критерий приемки на деле, отметь: ./backlog.py task edit BP-12 --check-ac 1 --check-ac 2
2. Итог — что сделано и как проверено: ./backlog.py task edit BP-12 --final-summary "…"
3. Статус Done — только когда все критерии отмечены: ./backlog.py task edit BP-12 -s Done
""",
}


def cmd_instructions(a, *_):
    print(GUIDES.get(a.guide or "overview") or f"гайды: {', '.join(GUIDES)}")


# --- разбор аргументов ----------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="backlog", description="Встроенный CLI Backlog.md (подмножество, формат 1.54)",
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__.split("\n\n", 2)[1])
    sub = ap.add_subparsers(dest="cmd")
    task = sub.add_parser("task", aliases=["tasks"], help="задачи")
    tsub = task.add_subparsers(dest="tcmd")

    c = tsub.add_parser("create", help="новая задача")
    c.add_argument("title")
    c.add_argument("-d", "--description", "--desc")
    c.add_argument("-a", "--assignee", action="append")
    c.add_argument("-s", "--status")
    c.add_argument("-l", "--labels", action="append")
    c.add_argument("-m", "--milestone")
    c.add_argument("-p", "--parent")
    c.add_argument("--ac", "--acceptance-criteria", action="append")
    c.add_argument("--dod", action="append")
    c.add_argument("--no-dod-defaults", action="store_true")
    c.add_argument("--dep", "--depends-on", action="append")
    c.add_argument("--ref", action="append")
    c.add_argument("--doc", action="append")
    c.add_argument("--plan")
    c.add_argument("--notes")
    c.add_argument("--ordinal")
    c.add_argument("--plain", action="store_true")
    c.set_defaults(fn=cmd_task_create)

    e = tsub.add_parser("edit", help="изменить задачу")
    e.add_argument("id")
    e.add_argument("-t", "--title")
    e.add_argument("-d", "--description", "--desc")
    e.add_argument("-a", "--assignee", action="append")
    e.add_argument("-s", "--status")
    e.add_argument("-l", "--label", action="append")
    e.add_argument("--add-label", action="append")
    e.add_argument("--remove-label", action="append")
    e.add_argument("--clear-labels", action="store_true")
    e.add_argument("-m", "--milestone")
    e.add_argument("--clear-milestone", action="store_true")
    e.add_argument("--ordinal")
    e.add_argument("--ac", action="append")
    e.add_argument("--acceptance-criteria", action="append")
    e.add_argument("--remove-ac", action="append")
    e.add_argument("--check-ac", action="append")
    e.add_argument("--uncheck-ac", action="append")
    e.add_argument("--clear-ac", action="store_true")
    e.add_argument("--dod", action="append")
    e.add_argument("--check-dod", action="append")
    e.add_argument("--uncheck-dod", action="append")
    e.add_argument("--dep", "--depends-on", action="append")
    e.add_argument("--clear-deps", action="store_true")
    e.add_argument("--ref", action="append")
    e.add_argument("--add-ref", action="append")
    e.add_argument("--remove-ref", action="append")
    e.add_argument("--clear-refs", action="store_true")
    e.add_argument("--doc", action="append")
    e.add_argument("--plan")
    e.add_argument("--append-plan", action="append")
    e.add_argument("--notes")
    e.add_argument("--append-notes", action="append")
    e.add_argument("--final-summary")
    e.add_argument("--comment")
    e.add_argument("--comment-author")
    e.add_argument("--plain", action="store_true")
    e.set_defaults(fn=cmd_task_edit)

    v = tsub.add_parser("view", help="показать задачу")
    v.add_argument("id")
    v.add_argument("--plain", action="store_true")
    v.add_argument("--json", action="store_true")
    v.set_defaults(fn=cmd_task_view)

    lst = tsub.add_parser("list", help="список задач")
    lst.add_argument("-s", "--status")
    lst.add_argument("-l", "--labels")
    lst.add_argument("--parent")
    lst.add_argument("--search")
    lst.add_argument("--plain", action="store_true")
    lst.add_argument("--json", action="store_true")
    lst.set_defaults(fn=cmd_task_list)

    doc = sub.add_parser("doc", help="документы")
    dsub = doc.add_subparsers(dest="dcmd")
    dc = dsub.add_parser("create")
    dc.add_argument("title")
    dc.add_argument("-p", "--path")
    dc.add_argument("-t", "--type")
    dc.add_argument("--plain", action="store_true")
    dc.set_defaults(fn=cmd_doc_create)
    du = dsub.add_parser("update")
    du.add_argument("id")
    du.add_argument("--title")
    du.add_argument("--content")
    du.add_argument("-t", "--type")
    du.add_argument("--tags")
    du.add_argument("-p", "--path")
    du.set_defaults(fn=cmd_doc_update)
    dv = dsub.add_parser("view")
    dv.add_argument("id")
    dv.add_argument("--plain", action="store_true")
    dv.set_defaults(fn=cmd_doc_view)
    dl = dsub.add_parser("list")
    dl.add_argument("--plain", action="store_true")
    dl.set_defaults(fn=cmd_doc_list)

    s = sub.add_parser("search", help="поиск по задачам и документам")
    s.add_argument("query")
    s.add_argument("--plain", action="store_true")
    s.set_defaults(fn=cmd_search)
    b = sub.add_parser("board", help="доска")
    b.add_argument("--plain", action="store_true")
    b.set_defaults(fn=cmd_board)
    i = sub.add_parser("instructions", help="гайды для агента")
    i.add_argument("guide", nargs="?")
    i.set_defaults(fn=cmd_instructions)
    return ap


def main(argv: list[str] | None = None) -> int:
    if hasattr(signal, "SIGPIPE"):
        signal.signal(signal.SIGPIPE, signal.SIG_DFL)  # `backlog task list | head` без трассировки
    argv = list(sys.argv[1:] if argv is None else argv)
    # `backlog task BP-12` — то же, что view
    if len(argv) >= 2 and argv[0] in ("task", "tasks") and re.fullmatch(r"[A-Za-z]+-\d+(\.\d+)*", argv[1]):
        argv = [argv[0], "view", *argv[1:]]
    ap = build_parser()
    a = ap.parse_args(argv)
    if not getattr(a, "fn", None):
        ap.print_help()
        return 0
    try:
        if a.fn is cmd_instructions:
            a.fn(a)
            return 0
        root = project_dir()
        bdir = bl.find_backlog(root)
        cfg = config(bdir)
        prefix = str(cfg.get("task_prefix") or "task").upper()
        a.fn(a, root, bdir, cfg, prefix)
    except Fail as e:
        print(f"backlog: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
