#!/usr/bin/env python3
"""bft-backlog-init — проект Backlog.md для карты инициативы из согласованной истории.

Создаёт папку `<epic>-blueprint/` — обычный проект Backlog.md (префикс задач `bp`, без git):
документ «Карта» (паспорт <!-- bft-map -->, пустые «Команды» и «Вопросы») и документ «История»
(история через экраны <!-- bft-story -->). Дальше агент ведёт бэклог через CLI `backlog`
по `resources/backlog_rules.md`, а страницу и архив собирает `bft-backlog-build.py`.

Есть CLI `backlog` (npm i -g backlog.md) — проект создаётся им (`backlog init`, `backlog doc create`);
нет — те же файлы пишутся напрямую в формате Backlog.md 1.54.

В README.md, CLAUDE.md и AGENTS.md проекта — блок «Service Blueprint»: что где лежит и как пересобрать.
`--guides` обновляет только этот блок в уже созданном проекте.

Использование:
    python3 bft-backlog-init.py <epic>-story.md [--dir ПАПКА] [--no-cli]
    python3 bft-backlog-init.py --guides <проект>
"""
from __future__ import annotations

import argparse
import datetime as dt
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import bft_backlog as bl  # noqa: E402
import bft_story as bs  # noqa: E402

START, END = "<!-- BFT-BLUEPRINT START -->", "<!-- BFT-BLUEPRINT END -->"
GUIDELINES = """
<!-- BACKLOG.MD GUIDELINES START -->
<!-- backlog.md-instructions-version: 1.54.0 -->
<CRITICAL_INSTRUCTION>

## Backlog.md Workflow

This project uses Backlog.md for task and project management.

**At the beginning of each conversation in this project, run `backlog instructions overview` before answering or taking action. Re-read it only if you have not read it yet in the current conversation.**

Use the overview to decide whether to search, read, create, or update Backlog tasks.

Before task lifecycle actions, read the matching detailed guide:
- `backlog instructions task-creation` before creating or splitting tasks
- `backlog instructions task-execution` before planning, changing status or assignee, adding a plan or implementation notes, or implementing task work
- `backlog instructions task-finalization` before checking acceptance criteria, writing final summaries, or moving tasks to terminal statuses

Use `backlog <command> --help` before running unfamiliar commands. Help shows options, fields, and examples.

Do not edit Backlog task, draft, document, decision, or milestone markdown files directly. Use the `backlog` CLI so metadata, relationships, and history stay consistent.

</CRITICAL_INSTRUCTION>
<!-- BACKLOG.MD GUIDELINES END -->
"""
CONFIG = """project_name: "{name}"
default_status: "To Do"
statuses: ["To Do", "In Progress", "Done"]
labels: []
date_format: yyyy-mm-dd
max_column_width: 20
auto_open_browser: true
default_port: 6420
remote_operations: false
auto_commit: false
filesystem_only: true
bypass_git_hooks: false
check_active_branches: false
active_branch_days: 30
task_prefix: "bp"
"""


def guide(title: str, epic: str, source: str) -> str:
    return f"""{START}
## Service Blueprint

Проект — карта инициативы «{title}» (эпик `{epic}`), собранная по БФТ `{source}`. Карта — это задачи и документы Backlog.md:

- **Что делаем** — задачи с меткой `stage:<этап>`: исполнитель — команда (`@teama`), описание — постановка для техлида, критерии приемки — чеклист;
- **Как это работает** — их подзадачи с меткой `layer:employee|technology|backstage|support`: параметры IDEF0, схема, HowToDemo;
- **документы** — «Карта» (команды и вопросы), «История» (этапы, шаги, экраны), `screens/` — требования к экранам для дизайнера.

Правила — `.blueprint/rules/backlog_rules.md`. Факты — только из БФТ; чего в нём нет — `[УТОЧНИТЬ у {{кого}}]` и строка в «Вопросах» документа «Карта». Задачи и документы правь только через CLI `backlog`. Блок IDEF0 не пиши: его собирает сборка из «Параметров».

После правок — из папки проекта:

```bash
python3 .blueprint/scripts/bft-backlog-lint.py .
python3 .blueprint/scripts/bft-backlog-build.py . --out-dir .
```

Сборка пишет страницу карты `{epic}-map.html` и архив проекта `{epic}-blueprint.zip`. Скрипты — только стандартная библиотека Python; в навыке они лежат в `<skills_path>/bft-blueprint/scripts/`.
{END}
"""


def put_block(path: Path, block: str, head: str = "") -> None:
    text = path.read_text(encoding="utf-8") if path.is_file() else head
    if START in text and END in text:
        text = text[:text.index(START)] + block.rstrip("\n") + text[text.index(END) + len(END):]
    else:
        text = text.rstrip("\n") + ("\n\n" if text.strip() else "") + block
    path.write_text(text if text.endswith("\n") else text + "\n", encoding="utf-8")


def write_guides(root: Path, title: str, epic: str, source: str) -> None:
    block = guide(title, epic, source)
    put_block(root / "README.md", block, f"# {title}\n\nService Blueprint инициативы `{epic}` — проект [Backlog.md](https://github.com/MrLesk/Backlog.md). "
              f"Доска: `backlog board` или `backlog browser`; страница карты — `blueprint.html` в архиве или `{epic}-map.html` после сборки.\n")
    for name in ("CLAUDE.md", "AGENTS.md"):
        put_block(root / name, block, GUIDELINES)


def now() -> str:
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M")


def doc_file(root: Path, n: int, title: str, body: str) -> None:
    f = root / "backlog" / "docs" / f"doc-{n} - {title.replace(' ', '-')}.md"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(f"---\nid: doc-{n}\ntitle: {title}\ntype: specification\ncreated_date: '{now()}'\n---\n{body}", encoding="utf-8")


def bodies(story: Path, st: bs.Story) -> tuple[str, str]:
    meta = st.meta
    title = st.title.split(":", 1)[1].strip() if ":" in st.title else st.title
    passport = {"epic_slug": meta["epic_slug"], "source_doc": meta["source_doc"], "source_stage": meta["source_stage"],
                "source_rev": meta["source_rev"], "version": "1", "revised": dt.date.today().isoformat(), "status": "Черновик"}
    m = "\n".join(["<!-- bft-map"] + [f"{k}: {passport[k]}" for k in bl.MAP_META] + ["-->", "", f"# Карта: {title}", "",
                   "Паспорт карты инициативы: команды и открытые вопросы. Задачи «Что делаем» и карточки «Как это работает» — в задачах проекта, история и требования к экранам — в документах.", "",
                   "## Команды", "", "| ID | Команда |", "| --- | --- |", "", "## Вопросы", "",
                   "| ID | Кому | Вопрос | Где | Тип | Ответ |", "| --- | --- | --- | --- | --- | --- |", ""])
    text = story.read_text(encoding="utf-8")
    _, fm, rest = text.split("---", 2)
    return m, "<!-- bft-story" + fm.rstrip() + "\n-->" + rest


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("story", type=Path, nargs="?", help="<epic>-story.md — согласованная история")
    ap.add_argument("--dir", type=Path, help="папка проекта (по умолчанию <epic>-blueprint рядом с историей)")
    ap.add_argument("--no-cli", action="store_true", help="не звать CLI backlog, писать файлы напрямую")
    ap.add_argument("--guides", type=Path, metavar="ПРОЕКТ", help="только обновить блок «Service Blueprint» в README, CLAUDE.md, AGENTS.md")
    args = ap.parse_args()
    if args.guides:
        pr = bl.parse(args.guides)
        if not pr.map_doc:
            print(f"{args.guides}: нет документа «Карта» — сначала создай проект", file=sys.stderr)
            return 1
        write_guides(args.guides, pr.title, pr.meta.get("epic_slug", ""), pr.meta.get("source_doc", ""))
        print(f"backlog-init: блок «Service Blueprint» обновлён в {args.guides}")
        return 0
    if not args.story or not args.story.is_file():
        ap.error("нужен файл истории <epic>-story.md")
    st = bs.parse(args.story)
    if st.errors:
        for i in st.errors:
            print(f"{args.story}:{i.line}: {i.level} {i.code} {i.msg}", file=sys.stderr)
        print("backlog-init: история с ошибками — сначала bft-story-lint.py", file=sys.stderr)
        return 1
    if st.meta.get("status", "").lower() != "согласован":
        print("backlog-init: история ещё не согласована PO (status: Согласован) — карта собирается после согласования", file=sys.stderr)
        return 1
    epic = st.meta["epic_slug"]
    root = args.dir or args.story.parent / f"{epic}-blueprint"
    if bl.find_backlog(root):
        print(f"backlog-init: {root} уже проект Backlog.md — правь его через CLI backlog", file=sys.stderr)
        return 1
    root.mkdir(parents=True, exist_ok=True)
    title = st.title.split(":", 1)[1].strip() if ":" in st.title else st.title
    map_body, story_body = bodies(args.story, st)
    cli = None if args.no_cli else shutil.which("backlog")
    if cli:
        run = lambda *a: subprocess.run([cli, *a], cwd=root, check=True, capture_output=True, text=True)  # noqa: E731
        run("init", title, "--no-git", "--defaults", "--agent-instructions", "claude,agents", "--integration-mode", "cli", "--task-prefix", "bp")
        run("doc", "create", "Карта", "-t", "specification")
        run("doc", "update", "doc-1", "--content", map_body)
        run("doc", "create", "История", "-t", "specification")
        run("doc", "update", "doc-2", "--content", story_body)
    else:
        (root / "backlog" / "tasks").mkdir(parents=True, exist_ok=True)
        (root / "backlog" / "config.yml").write_text(CONFIG.format(name=title.replace('"', "'")), encoding="utf-8")
        doc_file(root, 1, "Карта", map_body)
        doc_file(root, 2, "История", story_body)
    write_guides(root, title, epic, st.meta.get("source_doc", ""))
    print(f"backlog-init: {root} — проект Backlog.md ({'CLI backlog' if cli else 'файлы напрямую'}): документы «Карта» и «История»")
    print("дальше: команды и вопросы — в «Карту», задачи и карточки — `backlog task create` (resources/backlog_rules.md)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
