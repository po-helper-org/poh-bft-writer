#!/usr/bin/env python3
"""bft-backlog-init — автономный проект Backlog.md для карты инициативы из согласованной истории.

Создаёт папку `<epic>-blueprint/`, которую можно отдать любому харнессу и любой LLM — ничего ставить
не нужно, кроме python3:

  backlog/                   данные Backlog.md 1.54: config.yml, документы «Карта» и «История»
  backlog.py                 встроенный CLI Backlog.md: ./backlog.py task list --plain
  blueprint.py               проверка и сборка страницы карты: ./blueprint.py lint | build | check
  .blueprint/scripts, rules  скрипты сборки и правила карты
  CLAUDE.md, AGENTS.md,      инструкции агенту: что где лежит, правила, команды — без внешних ссылок
  GEMINI.md
  .claude/settings.json      Claude Code: команды проекта разрешены без запроса

Тот же набор `install()` обновляет сборка (`bft-backlog-build.py`), поэтому проект и архив
всегда несут текущие скрипты и правила. Установлен npm-пакет `backlog.md` — его `backlog`
работает с теми же файлами (доска в браузере — `backlog browser`).

Использование:
    python3 bft-backlog-init.py <epic>-story.md [--dir ПАПКА]
    python3 bft-backlog-init.py --guides <проект>      обновить скрипты, правила и инструкции
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import io
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import bft_backlog as bl  # noqa: E402
import bft_story as bs  # noqa: E402
import backlog_cli as cli  # noqa: E402

START, END = "<!-- BFT-BLUEPRINT START -->", "<!-- BFT-BLUEPRINT END -->"
NPM_START, NPM_END = "<!-- BACKLOG.MD GUIDELINES START -->", "<!-- BACKLOG.MD GUIDELINES END -->"
TOOLS = ("backlog_cli.py", "bft_blueprint.py", "bft_story.py", "bft_screens.py", "bft_backlog.py", "bft-blueprint-lint.py",
         "bft-backlog-lint.py", "bft-backlog-build.py", "bft-backlog-init.py", "page_kit.js", "map_page.js", "map_page.css")
RULES = ("backlog_rules.md", "screen_notes.md", "story_line.md")
AGENT_FILES = ("CLAUDE.md", "AGENTS.md", "GEMINI.md")
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

BACKLOG_SH = '''#!/usr/bin/env python3
"""Backlog.md этого проекта — встроенный CLI, только python3: ./backlog.py task list --plain (Windows: python backlog.py …)"""
import os, runpy, sys
here = os.path.dirname(os.path.abspath(__file__))
os.chdir(here)
sys.argv[0] = "backlog"
sys.path.insert(0, os.path.join(here, ".blueprint", "scripts"))
runpy.run_path(os.path.join(here, ".blueprint", "scripts", "backlog_cli.py"), run_name="__main__")
'''
BLUEPRINT_SH = '''#!/usr/bin/env python3
"""Карта этого проекта: ./blueprint.py lint | build | check   (build пишет страницу и архив в папку проекта)"""
import os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
scripts = os.path.join(here, ".blueprint", "scripts")
cmd, rest = (sys.argv[1] if len(sys.argv) > 1 else "help"), sys.argv[2:]
if cmd == "lint":
    run = ["bft-backlog-lint.py", here]
elif cmd == "build":
    run = ["bft-backlog-build.py", here, "--out-dir", here]
elif cmd == "check":
    run = ["bft-backlog-build.py", here, "--check"]
else:
    print("./blueprint.py lint   — проверить карту (коды BL, SN; правила — .blueprint/rules/backlog_rules.md)")
    print("./blueprint.py build  — схемы BPMN из «Процесса», страница <epic>-map.html и архив <epic>-blueprint.zip")
    print("./blueprint.py check  — проверка без записи: схемы и скрипты проекта актуальны")
    print("доп. ключи: --source БФТ.md — сверка с БФТ, --strict — предупреждения тоже ошибки")
    sys.exit(0 if cmd in ("help", "-h", "--help") else 2)
sys.exit(subprocess.call([sys.executable, os.path.join(scripts, run[0]), *run[1:], *rest]))
'''
ALLOW = ["Bash(./backlog.py:*)", "Bash(./blueprint.py:*)", "Bash(python3 backlog.py:*)", "Bash(python3 blueprint.py:*)",
         "Bash(python3 .blueprint/scripts/backlog_cli.py:*)", "Bash(python3 .blueprint/scripts/bft-backlog-lint.py:*)",
         "Bash(python3 .blueprint/scripts/bft-backlog-build.py:*)", "Read(.blueprint/**)", "Read(backlog/**)"]


def guide(title: str, epic: str, source: str) -> str:
    return f"""{START}
# Service Blueprint «{title}»

Проект автономен: всё для работы — в этой папке, ничего ставить не нужно, кроме python3.
Данные — проект [Backlog.md](https://github.com/MrLesk/Backlog.md) (формат 1.54); эпик `{epic}`, источник — БФТ `{source}`.

## Что здесь

| Путь | Что |
|---|---|
| `./backlog.py` | CLI Backlog.md, встроенный (`python3 backlog.py …` на Windows). Начни с `./backlog.py instructions overview` |
| `./blueprint.py` | `lint` — проверка карты, `build` — страница `{epic}-map.html` и архив `{epic}-blueprint.zip`, `check` — без записи |
| `backlog/tasks/` | задачи: «Что делаем» и их подзадачи «Как это работает» |
| `backlog/docs/` | документы: «Карта» (команды, вопросы), «История» (этапы, шаги, экраны), `screens/` — требования к экранам |
| `.blueprint/rules/` | правила: `backlog_rules.md` — карта, `screen_notes.md` — экраны, `story_line.md` — история |
| `blueprint.html`, `{epic}-map.html` | страница карты; в браузере — правой кнопкой замечание, меню «Замечания» — промпт агенту |

Установлен npm-пакет `backlog.md` — его `backlog board` и `backlog browser` работают с теми же файлами.

## Карта — это задачи и документы

- **Что делаем** — задача с меткой `stage:<этап>` и видом (`создать`, `доработать`, `используем`, `уточнить`), исполнитель — команда `@id` из «Карты» (неизвестна — метки `кандидат:<id>`). Описание: зачем; строка `Требования БФТ: …`; разделы `### ASIS`, `### GAP`, `### TOBE`, `### HowToDemo`, по желанию `### Дополнительно`. Чеклист приемки — критерии `--ac`.
- **Как это работает** — подзадача (`-p BP-N`) с метками `stage:<этап>` и `layer:employee|technology|backstage|support`. Описание: суть; `### UserStory` «Как <роль>, я хочу …, чтобы …»; `### JobStory` — список «- Когда …, хочу …, чтобы …»; `### Параметры` (`- **Вход:** …`, `- **Управление:** …`, `- **Выход:** …`, `- **Механизм:** …`, значения через `;`, ссылка `(BP-8.1)` — связь с карточкой); `### Процесс` — шаги `- Участник: действие`, развилка `- ? вопрос` и под ней ветки `  - да → Участник: действие` или `  - нет → конец`; `### HowToDemo`. Блок `### BPMN` не пиши — его собирает `./blueprint.py build` из процесса.
- **Требования к экрану** — документ `F3 · Название` в `backlog/docs/screens/`: `# Название`, картинки `![…](screen:F3)`, вкладки `## Product`, `## Design`, `## Functions`, заметки `### …` с `Источник: ФТ-1`.

Задачи без метки `stage:` на карте не показываются — это обычная работа: план реализации, баги.

## Правила

1. Задачи и документы меняй только через `./backlog.py`: файлы руками не правь.
2. Факты — только из БФТ и ответов PO. Неизвестное — `[УТОЧНИТЬ у {{кого}}]` в тексте и строка в «Вопросах» документа «Карта».
3. Названия и суть — без API, протоколов, таблиц БД: это высота БФТ.
4. После правок: `./blueprint.py lint` → 0 ошибок, затем `./blueprint.py build`.

## Частые действия

```bash
./backlog.py task list -l stage:F --plain                       # задачи этапа
./backlog.py task view BP-16 --plain                            # постановка целиком
./backlog.py task edit BP-16 --ac "Отказ — с понятной причиной"  # добавить критерий приемки
./backlog.py task edit BP-16 --add-ref https://jira.example.com/browse/DEMO-16 --notes "Ход работ"
./backlog.py task create "Проверка часового пояса" -p BP-16 -a "" -l "stage:F,layer:backstage" --no-dod-defaults \\
  -d $'Суть.\\n\\n### UserStory\\nКак …, я хочу …, чтобы …\\n\\n### JobStory\\n- Когда …, хочу …, чтобы …\\n\\n### Параметры\\n- **Вход:** …\\n- **Управление:** …\\n- **Выход:** …\\n- **Механизм:** …\\n\\n### Процесс\\n- Участник: действие\\n- ? Вопрос?\\n  - да → Участник: действие\\n  - нет → конец\\n\\n### HowToDemo\\n1. …\\n2. …'
./backlog.py doc view doc-1                                     # команды и вопросы
./backlog.py doc update doc-1 --content "$(cat карта.md)"        # правка документа целиком
./blueprint.py lint && ./blueprint.py build
```
{END}
"""


def merge_block(text: str, block: str) -> str:
    """Текст файла с нашим блоком: блок npm-версии Backlog.md уступает ему место — те же правила, команды ./backlog."""
    if NPM_START in text and NPM_END in text:
        text = (text[:text.index(NPM_START)] + text[text.index(NPM_END) + len(NPM_END):]).strip("\n") + "\n"
    if START in text and END in text:
        text = text[:text.index(START)] + block.rstrip("\n") + text[text.index(END) + len(END):]
    else:
        text = text.rstrip("\n") + ("\n\n" if text.strip() else "") + block
    return text.strip("\n") + "\n"


def rules_dir() -> Path:
    for p in (HERE.parent / "resources", HERE.parent / "rules"):
        if p.is_dir():
            return p
    return HERE.parent / "resources"


def wanted(root: Path, title: str, epic: str, source: str) -> dict[str, bytes]:
    """Файлы автономного проекта, которые держит навык: путь → содержимое."""
    out: dict[str, bytes] = {}
    for t in TOOLS:
        out[f".blueprint/scripts/{t}"] = (HERE / t).read_bytes()
    for r in RULES:
        if (rules_dir() / r).is_file():
            out[f".blueprint/rules/{r}"] = (rules_dir() / r).read_bytes()
    out["backlog.py"], out["blueprint.py"] = BACKLOG_SH.encode(), BLUEPRINT_SH.encode()
    block = guide(title, epic, source)
    head = (f"# {title}\n\nService Blueprint инициативы `{epic}` — автономный проект Backlog.md. "
            f"Доска: `./backlog.py board`; страница карты — `blueprint.html` или `{epic}-map.html` после `./blueprint.py build`.\n")
    for name in AGENT_FILES + ("README.md",):
        p = root / name
        text = p.read_text(encoding="utf-8") if p.is_file() else (head if name == "README.md" else "")
        out[name] = merge_block(text, block).encode()
    settings = root / ".claude" / "settings.json"
    try:
        cur = json.loads(settings.read_text(encoding="utf-8")) if settings.is_file() else {}
    except ValueError:
        cur = {}
    perms = cur.setdefault("permissions", {})
    perms["allow"] = list(dict.fromkeys([*perms.get("allow", []), *ALLOW]))
    out[".claude/settings.json"] = (json.dumps(cur, ensure_ascii=False, indent=2) + "\n").encode()
    return out


def install(root: Path, title: str, epic: str, source: str, write: bool = True) -> list[str]:
    """Скрипты, правила, обёртки и инструкции агенту в папке проекта. Возвращает изменённые пути."""
    changed = []
    for rel, data in wanted(root, title, epic, source).items():
        p = root / rel
        if p.is_file() and p.read_bytes() == data:
            continue
        changed.append(rel)
        if write:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
            if rel in ("backlog.py", "blueprint.py"):
                p.chmod(0o755)
    return changed


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


def backlog(root: Path, *args: str) -> None:
    cwd = os.getcwd()
    os.chdir(root)
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            if cli.main(list(args)):
                raise SystemExit(f"backlog {' '.join(args[:2])}: ошибка")
    finally:
        os.chdir(cwd)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("story", type=Path, nargs="?", help="<epic>-story.md — согласованная история")
    ap.add_argument("--dir", type=Path, help="папка проекта (по умолчанию <epic>-blueprint рядом с историей)")
    ap.add_argument("--guides", type=Path, metavar="ПРОЕКТ", help="обновить скрипты, правила и инструкции агенту в проекте")
    args = ap.parse_args()
    if args.guides:
        pr = bl.parse(args.guides)
        if not pr.map_doc:
            print(f"{args.guides}: нет документа «Карта» — сначала создай проект", file=sys.stderr)
            return 1
        changed = install(args.guides, pr.title, pr.meta.get("epic_slug", ""), pr.meta.get("source_doc", ""))
        print(f"backlog-init: {args.guides} — обновлено файлов {len(changed)}")
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
        print(f"backlog-init: {root} уже проект Backlog.md — правь его через ./backlog.py", file=sys.stderr)
        return 1
    title = st.title.split(":", 1)[1].strip() if ":" in st.title else st.title
    map_body, story_body = bodies(args.story, st)
    (root / "backlog" / "tasks").mkdir(parents=True, exist_ok=True)
    (root / "backlog" / "docs").mkdir(parents=True, exist_ok=True)
    (root / "backlog" / "config.yml").write_text(CONFIG.format(name=title.replace('"', "'")), encoding="utf-8")
    backlog(root, "doc", "create", "Карта", "-t", "specification")
    backlog(root, "doc", "update", "doc-1", "--content", map_body)
    backlog(root, "doc", "create", "История", "-t", "specification")
    backlog(root, "doc", "update", "doc-2", "--content", story_body)
    install(root, title, epic, st.meta.get("source_doc", ""))
    print(f"backlog-init: {root} — автономный проект Backlog.md: документы «Карта» и «История», ./backlog.py, ./blueprint.py, инструкции агенту")
    print("дальше: команды и вопросы — в «Карту», задачи и карточки — ./backlog.py task create (.blueprint/rules/backlog_rules.md)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
