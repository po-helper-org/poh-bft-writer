#!/usr/bin/env python3
"""Постановки задач для техлида — бэклог карты, по файлу `tasks/<ID>.md` на задачу «Что делаем».

Файл — обычный markdown, разделы по порядку:

    ## ASIS                 как сейчас устроено — коротко
    ## GAP                  чем текущее не соответствует требованиям
    ## TOBE                 какой станет система после доработки
    ## HowToDemo            нумерованный E2E-сценарий: 1. … 2. …
    ## Чеклист приемки      Definition of Done: - [ ] …
    ## Дополнительно        по желанию: ссылки, ограничения, контекст
    ## Исполнение           по желанию: «JIRA: ссылка», «Confluence: ссылка», заметка исполнителя

Требования БФТ и открытые вопросы задачи страница добавляет к «Дополнительно» сама — из карты.
Неизвестное — `[УТОЧНИТЬ у {кого}]`. Стандарт — `resources/task_brief.md`.

  ОШИБКИ                                        ПРЕДУПРЕЖДЕНИЯ
  TK001  файл не по задаче карты                TK020  задача без постановки
  TK002  разделы не те, не по порядку или
         нет обязательного; текст вне раздела
  TK003  пустой раздел
  TK004  HowToDemo: меньше двух шагов «1. …»
  TK005  Чеклист приемки: нет пунктов «- [ ] …»

Только стандартная библиотека.
"""
from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bft_blueprint as bb  # noqa: E402

DIR = "tasks"
SECTIONS = ("ASIS", "GAP", "TOBE", "HowToDemo", "Чеклист приемки", "Дополнительно", "Исполнение")
OPTIONAL = {"Дополнительно", "Исполнение"}
STEP_RE = re.compile(r"^\d+\.\s+\S")
CHECK_RE = re.compile(r"^[-*]\s+\[[ xX]\]\s+\S")


@dataclass
class TaskDoc:
    id: str
    path: Path
    sections: dict = field(default_factory=dict)  # {раздел: (строка, текст)}
    text: str = ""


def parse(path: Path, issues: list) -> TaskDoc:
    rel = f"{DIR}/{path.name}"
    doc = TaskDoc(path.name[:-3], path, text=path.read_text(encoding="utf-8"))
    err = lambda n, code, msg: issues.append(bb.Issue(n, "ERROR", code, msg, rel))  # noqa: E731
    order, cur, body, start = [], None, [], 0

    def close():
        if cur is not None:
            doc.sections[cur] = (start, "\n".join(body).strip())

    for n, raw in enumerate(doc.text.split("\n"), start=1):
        line = raw.rstrip()
        if line.startswith("## "):
            close()
            name = line[3:].strip()
            if name not in SECTIONS:
                err(n, "TK002", f"раздел «{name}» — один из {', '.join(SECTIONS)}")
                cur = None
                continue
            if name in doc.sections or name in order:
                err(n, "TK002", f"раздел {name} уже был")
            order.append(name)
            cur, body, start = name, [], n
        elif line.startswith("# "):
            continue  # заголовок файла не нужен: название задачи — в карте
        elif cur is not None:
            body.append(line)
        elif line.strip():
            err(n, "TK002", "текст вне раздела — под `## ASIS`, `## GAP` …")
    close()
    if order != [s for s in SECTIONS if s in order]:
        err(1, "TK002", "разделы по порядку: " + " → ".join(SECTIONS))
    for s in SECTIONS:
        if s in OPTIONAL:
            continue
        if s not in doc.sections:
            err(1, "TK002", f"нет раздела `## {s}`")
        elif not doc.sections[s][1]:
            err(doc.sections[s][0], "TK003", f"раздел {s} пустой")
    if "HowToDemo" in doc.sections:
        n, t = doc.sections["HowToDemo"]
        if sum(bool(STEP_RE.match(x.strip())) for x in t.split("\n")) < 2:
            err(n, "TK004", "HowToDemo — нумерованный сценарий хотя бы из двух шагов «1. …»")
    if "Чеклист приемки" in doc.sections:
        n, t = doc.sections["Чеклист приемки"]
        if not any(CHECK_RE.match(x.strip()) for x in t.split("\n")):
            err(n, "TK005", "Чеклист приемки — пункты «- [ ] …»")
    return doc


def check(map_path: Path, task_ids: set[str]) -> tuple[dict[str, TaskDoc], list]:
    """Все файлы `tasks/*.md` рядом с картой: разбор и проверка."""
    issues: list = []
    folder = map_path.parent / DIR
    docs: dict[str, TaskDoc] = {}
    files = sorted(folder.glob("*.md")) if folder.is_dir() else []
    for f in files:
        doc = parse(f, issues)
        if doc.id not in task_ids:
            issues.append(bb.Issue(1, "ERROR", "TK001", f"задачи {doc.id} нет в карте — имя файла = ID задачи (6.3.md)", f"{DIR}/{f.name}"))
            continue
        docs[doc.id] = doc
    missing = sorted(task_ids - set(docs), key=lambda x: [int(p) for p in x.split(".")])
    if missing:
        issues.append(bb.Issue(1, "WARN", "TK020", f"задачи без постановки для техлида ({DIR}/<ID>.md): {', '.join(missing)}"))
    return docs, issues
