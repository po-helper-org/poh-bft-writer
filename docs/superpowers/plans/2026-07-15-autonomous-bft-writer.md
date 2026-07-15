# Autonomous bft-writer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Изолировать BFT-слой po-helper в самодостаточный репозиторий poh-bft-writer с нативной файловой само-индексацией и мульти-агентной установкой, без единой зависимости от po-helper.

**Architecture:** Пайплайн генерации БФТ якорится на само-генерируемый markdown-индекс воркспейса (`.bft/index/`) вместо внешних CORTEX/Nexus/People Graph. Новый навык `bft-indexer` + команда `/bft-index` строят индекс из локальных доков, кода (serena) и трекера (JIRA/Confluence MCP, опц.). Практики качества (16 hard gates, Humanizer, Lessons Learned, корп-шаблон v10, golden-референсы) переносятся verbatim. Установка — `install.sh` в стиле sa-helper (мульти-агент).

**Tech Stack:** Markdown skill/command файлы (Claude Code формат), bash (install.sh), serena MCP (семантика кода), Atlassian MCP (JIRA/Confluence, опц.).

## Global Constraints

- **Ноль зависимостей от po-helper.** Запрещены в перенесённых файлах: `CORTEX`, `Nexus`/`Нексус`, `People Graph`, `repowise`, `backlog`-доска как обязательная, `domain-profile`, `sa_documentation`, `bft_documentation/`, `superset`, `paf`, `{wiki.space}`, `{tracker.projects}`, `{bft_store}`. Проверяется grep в каждой port-задаче.
- **Практики качества — verbatim.** Файлы `skills/bft-writer/resources/{hard_gates,bft_standards,writing_style,review_feedback,anchor_rules,catwoe,debate_rules}.md` и `examples/{golden_bft_example,ideal_bft}.md` переносятся без изменений методологии; допускается только чистка явных утечек лесов инструмента (пути CORTEX, авторы-роботы).
- **Нулевой допуск галлюцинаций.** Каждый факт → якорь. Нет источника → `[УТОЧНИТЬ у {кого}]`. Пусто ≠ «нет данных».
- **Индекс-путь:** `.bft/index/`. Артефакты эпика: `.bft/documentation/<epic>/`. Оба под gitignore по умолчанию.
- **Язык контента:** русский (домен MTS). Диаграммы — только PlantUML.
- **Источник переноса:** локальная копия `kibarik/po-helper` main в `<scratchpad>/po-helper.git` (bare-ish clone уже сделан). Целевые файлы уже скопированы в `poh-bft-writer/commands/` (9 шт) и `poh-bft-writer/skills/` (bft-writer, bft-fast, bft-deep-swarm) — port-задачи редактируют их на месте.
- **Рабочая директория:** `/Users/aleksishmanov/projects/poh-org/poh-bft-writer` (локальный git, без remote).

---

## File Structure

```
poh-bft-writer/
├── .gitignore                       # есть (Task 0 done)
├── README.md                        # Task 1 — curl + HowToDemo + quickstart
├── bft-config.template.md           # Task 1 — конфиг воркспейса
├── install.sh                       # Task 2 — мульти-агент установщик
├── commands/
│   ├── bft-index.md                 # Task 3 — NEW
│   ├── bft-context-gen.md           # Task 5 — repoint index-first
│   ├── bft-problem.md               # Task 5
│   ├── bft-concept.md               # Task 5
│   ├── bft-debate.md                # Task 5
│   ├── bft-draft.md                 # Task 5
│   ├── bft-validate.md              # Task 5
│   ├── bft-deliver.md               # Task 5
│   ├── bft-fast.md                  # Task 6
│   └── bft-deep.md                  # Task 7 — repoint context-gen-deep→/bft-index
├── skills/
│   ├── bft-indexer/                 # Task 3 — NEW
│   │   ├── SKILL.md
│   │   └── resources/index_schema.md
│   ├── bft-writer/                  # Task 4 — decouple SKILL, resources verbatim
│   ├── bft-fast/                    # Task 6
│   └── bft-deep-swarm/              # Task 7
└── docs/
    ├── specs/2026-07-15-autonomous-bft-writer-design.md   # done
    └── superpowers/plans/2026-07-15-autonomous-bft-writer.md  # этот файл
```

---

## Task 1: README + bft-config template

**Files:**
- Create: `poh-bft-writer/README.md`
- Create: `poh-bft-writer/bft-config.template.md`

**Interfaces:**
- Produces: `bft-config.template.md` — контракт конфига воркспейса, который читают `/bft-index` и `/bft-context-gen` (Task 3, 5). Ключи: `tracker_projects`, `wiki_space`, `source_globs`, `index_path`, `docs_path`.

- [ ] **Step 1: Verification-first — задать проверку**

Проверка готовности: README содержит секции «Установка» (curl), «HowToDemo» (6 пунктов), «Быстрый старт», «Команды». `bft-config.template.md` содержит все 5 ключей.

- [ ] **Step 2: Написать `bft-config.template.md`**

```markdown
# bft-config (шаблон)

Скопируй в корень воркспейса как `bft-config.md` и заполни. Читается `/bft-index` и пайплайном.
Всё опционально — незаданное автодетектится или пропускается (в MANIFEST помечается UNAVAILABLE).

## tracker_projects
Коды проектов трекера через запятую (напр. `GDSLV, BOOK`). Пусто → JIRA-подтяжка выключена.

## wiki_space
Ключ пространства Confluence для публикации БФТ (напр. `GDS`). Пусто → публикация ручная.

## source_globs
Glob-паттерны локальных источников для индексации (по строке на паттерн):
- `docs/**/*.md`
- `**/*.pdf`
- `**/*.docx`
Пусто → дефолт: `**/*.md` минус node_modules/vendor/dist.

## docs_path
Куда класть готовые БФТ и артефакты эпиков. Дефолт: `.bft/documentation`.

## index_path
Куда класть индекс. Дефолт: `.bft/index`.
```

- [ ] **Step 3: Написать `README.md`**

```markdown
# poh-bft-writer

Автономный генератор БФТ (бизнес-функциональных требований) для эпиков трекера в
корпоративном формате MTS. Переносимый навык: подключается в любой воркспейс, сам строит
контекст, генерирует БФТ уровня отлаженной методологии po-helper — без внешних зависимостей.

## Установка

**Через ИИ-помощника:** скажи «Установи bft-writer в этот репозиторий».

**Через терминал:**
```bash
curl -ksSL https://raw.githubusercontent.com/kibarik/poh-bft-writer/main/install.sh | bash
```
Скрипт спросит IDE-агента (Claude Code / Codex / Cline / DevX / Universal) и синкнет
команды и навыки в нужный корень. После установки запусти `/bft-index` — навык проведёт
первичную аналитику воркспейса и построит себе контекст.

## HowToDemo

1. «Установи bft-writer» или curl из README → навык в репозитории.
2. Команды `/bft-*` доступны.
3. `/bft-index` проводит первичную аналитику и строит контекст (`.bft/index/`).
4. Полный workflow: `/bft-context-gen → /bft-problem → /bft-concept → /bft-debate → /bft-draft → /bft-validate → /bft-deliver` (STOP-паузы, human-in-the-loop).
5. v2 автономка: `/bft-fast` (быстрый черновик из письма) + `/bft-deep` (обогащение swarm).
6. Результат соответствует практикам po-helper: 16 hard gates, стиль/голос, Lessons Learned, корп-шаблон v10, ранги якорей, CATWOE, adversarial-дебаты.

## Быстрый старт

1. `cp bft-config.template.md bft-config.md`, заполни (или оставь пусто — автодетект).
2. `/bft-index` — построить контекст.
3. `/bft-context-gen <epic> <jira_key>` — начать пайплайн. Дальше по стадиям.

## Команды

| Команда | Роль | Артефакт |
|---|---|---|
| `/bft-index` | Context Builder | `.bft/index/` (пакеты знаний) |
| `/bft-context-gen` | Context Builder | `artefacts/bft-context-pack.md` |
| `/bft-problem` | Problem Analyst | `artefacts/problem.md` |
| `/bft-concept` | Solution Designer | `artefacts/concept.md` |
| `/bft-debate` | Devil's Advocate | вердикт в `concept.md` |
| `/bft-draft` | Requirements Writer | `<epic>.md` (финальный БФТ) |
| `/bft-validate` | Validator | `artefacts/validation.md` |
| `/bft-deliver` | Deliverer | публикация JIRA+Confluence |
| `/bft-fast` | Fast lane | быстрый черновик БФТ |
| `/bft-deep` | Deep swarm | обогащённый БФТ |

## Как это работает

Пайплайн якорится на `.bft/index/` — само-генерируемый набор markdown-пакетов
(архитектура, домен-правила, решения, глоссарий, стейкхолдеры, реестр якорей). `/bft-index`
собирает их из локальных доков, кода (через serena MCP) и трекера (JIRA/Confluence MCP,
опционально). Каждый факт в БФТ прослеживается до источника; неизвестное помечается
`[УТОЧНИТЬ]`, не выдумывается.
```

- [ ] **Step 4: Проверка**

Run: `cd poh-bft-writer && grep -c "HowToDemo" README.md && grep -cE "tracker_projects|wiki_space|source_globs|docs_path|index_path" bft-config.template.md`
Expected: `1` и `5`.

- [ ] **Step 5: Commit**

```bash
cd poh-bft-writer
git add README.md bft-config.template.md
git commit -m "feat: README + bft-config template

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: install.sh (мульти-агент установщик)

**Files:**
- Create: `poh-bft-writer/install.sh`

**Interfaces:**
- Consumes: структура `commands/` и `skills/` репозитория.
- Produces: синк управляемых подпапок в корень выбранного IDE-агента + инъекцию frontmatter в SKILL.md (аналог sa-helper `sync_canonical_skills`).

**Reference:** паттерн взят из `/Users/aleksishmanov/projects/poh-org/poh-news/sa-helper/install.sh` (функции `sync_managed_tree`, `sync_canonical_skills`).

- [ ] **Step 1: Verification-first**

Проверка: `bash install.sh` с выбором «Claude Code» в пустой temp-директории создаёт `.claude/commands/bft-*.md` (10 шт) и `.claude/skills/{bft-indexer,bft-writer,bft-fast,bft-deep-swarm}/SKILL.md` с frontmatter (`name:`, `description:`).

- [ ] **Step 2: Написать `install.sh`**

```bash
#!/bin/bash
set -e
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
REPO_URL="https://github.com/kibarik/poh-bft-writer.git"
TEMP_DIR=".bft_writer_temp"

# Источник: если запущено из клона — текущая папка; если через curl — клонируем
if [ -d "./commands" ] && [ -d "./skills" ]; then
  SRC="."
else
  echo -e "${BLUE}Клонирую poh-bft-writer…${NC}"
  rm -rf "$TEMP_DIR"
  git clone --depth 1 "$REPO_URL" "$TEMP_DIR"
  SRC="$TEMP_DIR"
fi

echo -e "${BLUE}Какой IDE-агент?${NC}"
echo "  1) Claude Code   (.claude/)"
echo "  2) Codex         (.agents/)"
echo "  3) Cline         (.clinerules/)"
echo "  4) DevX (МТС)    (.clinerules/)"
echo "  5) Universal     (.agents/)"
read -rp "Выбор [1]: " choice
choice="${choice:-1}"
case "$choice" in
  1) ROOT=".claude";     CMD_DIR="commands" ;;
  2) ROOT=".agents";     CMD_DIR="prompts" ;;
  3) ROOT=".clinerules"; CMD_DIR="workflows" ;;
  4) ROOT=".clinerules"; CMD_DIR="workflows" ;;
  5) ROOT=".agents";     CMD_DIR="commands" ;;
  *) echo "Неизвестный выбор"; exit 1 ;;
esac

# Синк команд
mkdir -p "$ROOT/$CMD_DIR"
cp -R "$SRC"/commands/. "$ROOT/$CMD_DIR"/

# Синк навыков с инъекцией frontmatter (name + description из первой строки SKILL.md)
mkdir -p "$ROOT/skills"
for skill_src in "$SRC"/skills/*; do
  [ -d "$skill_src" ] || continue
  [ -f "$skill_src/SKILL.md" ] || continue
  skill_name="$(basename "$skill_src")"
  skill_dst="$ROOT/skills/$skill_name"
  mkdir -p "$skill_dst"
  cp -R "$skill_src"/. "$skill_dst"/
  # description = первая '# '-строка SKILL.md; если frontmatter уже есть — не дублируем
  if ! head -1 "$skill_src/SKILL.md" | grep -q '^---$'; then
    desc="$(sed -n '1s/^# *//p;q' "$skill_src/SKILL.md")"
    desc="${desc:-$skill_name}"
    { printf -- '---\nname: %s\ndescription: "%s"\n---\n' "$skill_name" "$desc"; sed '1d' "$skill_src/SKILL.md"; } > "$skill_dst/SKILL.md"
  fi
done

# Конфиг-шаблон в корень (если ещё нет)
[ -f bft-config.md ] || cp "$SRC/bft-config.template.md" ./bft-config.template.md 2>/dev/null || true

[ "$SRC" = "$TEMP_DIR" ] && rm -rf "$TEMP_DIR"

echo -e "${GREEN}✔ Установлено в $ROOT/${NC}"
echo -e "${YELLOW}Следующий шаг:${NC} запусти ${GREEN}/bft-index${NC} — навык построит контекст воркспейса."
```

- [ ] **Step 3: Проверка (dry-run в temp)**

```bash
cd poh-bft-writer
T=$(mktemp -d); cp -R commands skills bft-config.template.md "$T"/ 2>/dev/null; cp install.sh "$T"/
cd "$T" && echo "1" | bash install.sh
ls .claude/commands/ | grep -c "bft-" ; ls .claude/skills/
```
Expected: команды присутствуют (9 сейчас, 10 после Task 3), навыки `bft-writer bft-fast bft-deep-swarm` (+ `bft-indexer` после Task 3). Frontmatter-инъекция: `head -1 .claude/skills/bft-writer/SKILL.md` → `---` (или уже был).

- [ ] **Step 4: Commit**

```bash
cd poh-bft-writer
git add install.sh
git commit -m "feat: multi-agent install.sh

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: bft-indexer skill + /bft-index команда (NEW — ядро автономности)

**Files:**
- Create: `poh-bft-writer/skills/bft-indexer/SKILL.md`
- Create: `poh-bft-writer/skills/bft-indexer/resources/index_schema.md`
- Create: `poh-bft-writer/commands/bft-index.md`

**Interfaces:**
- Produces: `.bft/index/` пакеты (`MANIFEST.md`, `architecture.md`, `domain-rules.md`, `decisions.md`, `regulatory.md`, `glossary.md`, `stakeholders.md`, `sources.md`) — контракт, который читают `/bft-context-gen` (Task 5) и `/bft-deep` (Task 7). Каждый пак: заголовки-разделы + факты с inline-якорем `[источник: <anchor>]`.
- Consumes: `bft-config.md` (Task 1), serena MCP (опц.), Atlassian MCP (опц.).

- [ ] **Step 1: Verification-first**

Проверка: `/bft-index` при запуске в воркспейсе создаёт все 8 файлов в `.bft/index/`; `MANIFEST.md` перечисляет каждый источник со статусом (INDEXED/UNAVAILABLE) и датой; каждый факт-пак содержит хотя бы один `[источник:` якорь или явную пометку `[УТОЧНИТЬ]`.

- [ ] **Step 2: Написать `skills/bft-indexer/resources/index_schema.md`**

Полное содержимое — схема каждого пака:

```markdown
# Схема индекса `.bft/index/`

Само-генерируемый контекст воркспейса. CORTEX-эквивалент, но собирается локально из
доступных источников. Правило: пусто ≠ «нет данных» — недоступный источник помечается
UNAVAILABLE в MANIFEST, вывод из него → `[УТОЧНИТЬ]`.

## MANIFEST.md
Карта покрытия. Таблица: Источник | Тип (docs/code/tracker) | Статус (INDEXED/UNAVAILABLE) |
Дата | Охват (файлов/страниц). Плюс строка «Индекс собран: <дата>».

## architecture.md  (роль C1)
Компоненты, сервисы, интеграции воркспейса. Из кода (serena: модули/пакеты/точки входа) +
доков-описаний. Каждый компонент: назначение + якорь `[источник: path:line | doc.md]`.

## domain-rules.md  (роль C2)
Бизнес-правила предметной области. Из доков/спек/существующих БФТ. Правило + якорь.

## decisions.md  (роль C5)
ADR и зафиксированные решения. Из `**/ADR*.md`, `**/decisions/**`, комментов трекера.
Решение + дата + якорь.

## regulatory.md  (роль C3, опц.)
Compliance/регуляторика (ПДн, отраслевое). Если в источниках нет — файл создаётся с
пометкой «Регуляторных источников не найдено — заполнить вручную при необходимости».

## glossary.md
Термины домена: термин → определение → якорь. Из доков + частотного анализа.

## stakeholders.md  (замена People Graph)
Роли/команды/владельцы. Из CODEOWNERS, git-истории (частые авторы по областям),
доков-контактов, трекера (assignee/reporter). Роль → зона ответственности → якорь.

## sources.md
Плоский реестр всех использованных якорей: id якоря → полный источник (path:line /
JIRA-key / Confluence-URL / doc). На него ссылаются пакеты и финальный раздел «Якоря» БФТ.
```

- [ ] **Step 3: Написать `skills/bft-indexer/SKILL.md`**

```markdown
# Навык: Индексатор контекста БФТ (BFT Context Indexer)

## Роль
Ты — Context Builder. Навык проводит первичную аналитику воркспейса и строит
само-генерируемый индекс `.bft/index/` — основу грудинга для всего пайплайна БФТ.
Заменяет внешние базы знаний (CORTEX/Nexus): всё собирается локально из того, что есть.

## Принцип нулевого допуска
Каждый факт в индексе → якорь-источник (`path:line`, doc, JIRA-key, Confluence-URL),
записанный inline как `[источник: <anchor>]` и в реестр `sources.md`. Источник недоступен →
в `MANIFEST.md` статус UNAVAILABLE; вывод оттуда в паках → `[УТОЧНИТЬ у {кого}]`.
Пусто ≠ «нет данных».

## Источники (автодетект, per-source fallback)
1. **Доки** — glob из `bft-config.md → source_globs` (дефолт `**/*.md` минус node_modules/
   vendor/dist/.git). PDF/DOCX — если заданы в globs, читать через доступные средства.
2. **Код** — через serena MCP (`get_symbols_overview`, `find_symbol`), если в воркспейсе есть
   код и serena подключена. Даёт As-Is якоря `path:line`. serena нет → пометить в MANIFEST,
   архитектуру собрать из доков.
3. **Трекер** — JIRA/Confluence через Atlassian MCP, если `tracker_projects`/`wiki_space`
   заданы и MCP доступен. Иначе UNAVAILABLE.

Фильтрация (не индексировать): boilerplate/миграции/логи, node_modules/vendor/dist,
моки/фикстуры, ассеты (картинки/шрифты/скомпилированное).

## Процесс
1. Прочитать `bft-config.md` (нет → дефолты, отметить в MANIFEST).
2. Инвентаризация источников по типам, заполнить MANIFEST (статусы).
3. По каждому паку схемы (`resources/index_schema.md`) — извлечь факты с якорями.
4. Собрать `sources.md` — реестр всех якорей.
5. STOP: показать MANIFEST (покрытие), дать PO решить — достаточно ли для пайплайна.

Инкрементальность: повторный `/bft-index` идемпотентен — обновляет паки, не плодит дубли,
дата в MANIFEST обновляется.

## Ресурсы
- `resources/index_schema.md` — схема каждого пака индекса.

## Главное правило
Индекс — доказательная база пайплайна. Что не попало в индекс с якорем — в БФТ идёт как
`[УТОЧНИТЬ]`, а не как факт. Качество БФТ ≤ качество индекса — не выдумывай покрытие.
```

- [ ] **Step 4: Написать `commands/bft-index.md`**

```markdown
---
description: Первичная аналитика воркспейса и построение индекса `.bft/index/` — основа грудинга для пайплайна БФТ. Автодетект источников (доки/код через serena/трекер). Запусти после установки.
---

## Использование
```
/bft-index
```
Без аргументов — сканирует весь воркспейс по `bft-config.md`. Опционально `/bft-index <подпапка>`
— ограничить область.

## Роль
Context Builder (навык `bft-indexer`).

## Что делает
1. Читает `bft-config.md` (source_globs, tracker_projects, wiki_space; нет файла → дефолты).
2. Инвентаризирует источники: локальные доки (glob), код (serena MCP если есть), трекер
   (Atlassian MCP если сконфигурирован).
3. Строит `.bft/index/`: MANIFEST + 7 паков знаний (см. навык `bft-indexer`,
   `resources/index_schema.md`).
4. STOP: выводит MANIFEST-покрытие, ждёт решения PO.

## На выходе
`.bft/index/{MANIFEST,architecture,domain-rules,decisions,regulatory,glossary,stakeholders,sources}.md`.
Каждый факт с якорем `[источник: …]`. Недоступные источники → UNAVAILABLE + `[УТОЧНИТЬ]`.

## Дальше
`/bft-context-gen <epic> <jira_key>` — стартовать пайплайн (быстрый контекст-пак читает индекс).
```

- [ ] **Step 5: Проверка структуры**

Run: `cd poh-bft-writer && test -f skills/bft-indexer/SKILL.md && test -f skills/bft-indexer/resources/index_schema.md && test -f commands/bft-index.md && grep -c "\.bft/index" skills/bft-indexer/SKILL.md`
Expected: exit 0, число ≥ 1.

- [ ] **Step 6: Commit**

```bash
cd poh-bft-writer
git add skills/bft-indexer commands/bft-index.md
git commit -m "feat: bft-indexer skill + /bft-index command

Само-генерируемый индекс воркспейса как замена CORTEX/Nexus.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Декаплинг skill bft-writer (SKILL.md repoint, resources verbatim)

**Files:**
- Modify: `poh-bft-writer/skills/bft-writer/SKILL.md`
- Verbatim (проверить, не менять методологию): `skills/bft-writer/resources/{hard_gates,bft_standards,writing_style,review_feedback,anchor_rules,catwoe,debate_rules,constraint_rules}.md`, `examples/{golden_bft_example,ideal_bft}.md`

**Interfaces:**
- Consumes: `.bft/index/` (Task 3).
- Produces: декаплённый навык bft-writer — контракт пайплайна для команд Task 5.

- [ ] **Step 1: Verification-first — задать грепы отсутствия связей**

Целевые запрещённые токены (после правки должны исчезнуть из SKILL.md): `CORTEX`, `Nexus`,
`People Graph`, `domain-profile`, `bft_documentation`, `{wiki.space}`, `{tracker.projects}`,
`{bft_store}`, `backlog task`, `--check-ac`. Раздел «§ Синхронизация с доской Backlog.md» —
удалён целиком.

- [ ] **Step 2: Удалить секцию Backlog.md**

Удалить из `SKILL.md` весь блок от заголовка `## § Синхронизация с доской (Backlog.md control)`
до конца этого раздела (перед `## Главное правило процесса`). Это операционная инфра po-helper,
вне scope генерации БФТ.

- [ ] **Step 3: Repoint грудинга — заменить строки-источники**

Применить замены (grep-mapping) по всему `SKILL.md`:

| Было | Стало |
|---|---|
| `CORTEX-кортексы` / `Кортексы CORTEX (C1 … C5) — статичный фон, подключаются в /bft-context-gen` | `Индекс воркспейса .bft/index/ (architecture/domain-rules/decisions/regulatory) — строится /bft-index, читается /bft-context-gen` |
| `CORTEX C1/C3/BR/C5 + JIRA` (роль Context Builder) | `Индекс .bft/index/ + JIRA (опц.)` |
| `{wiki.space}` | `wiki_space из bft-config` |
| `tracker.projects` / `{tracker.projects}` | `tracker_projects из bft-config` |
| `.claude/domain-profile.md` | `bft-config.md` |
| `<workspace>/<epic>/` | `.bft/documentation/<epic>/` |
| `{bft_store}/золотой референс …` | `examples/golden_bft_example.md` |

Строку 9 (`multi-step pipeline из 7 команд`) оставить. Пайплайн-блок (стадии) оставить как есть
(команды не меняются). Принципы 1-15 — оставить verbatim (методология). В принципе 13 (CATWOE +
ранги якорей) и «Якоря истины» — оставить, они про качество, не про CORTEX.

- [ ] **Step 4: Обновить раздел «Стандарты и ресурсы»**

Убрать ссылку на `constraint_rules.md` как ресурс стадии `/bft-constraints` (команда выкинута) —
либо удалить строку, либо переформулировать: `constraint_rules.md — критерии ограничений
релиза (справочно, используется при проработке problem/concept)`. Файл ресурса оставить.

- [ ] **Step 5: Проверка отсутствия связей**

Run:
```bash
cd poh-bft-writer
grep -nE "CORTEX|Nexus|People Graph|domain-profile|bft_documentation|\{wiki\.space\}|\{tracker\.projects\}|\{bft_store\}|backlog task|--check-ac|Синхронизация с доской" skills/bft-writer/SKILL.md
```
Expected: пусто (нет совпадений).

- [ ] **Step 6: Проверка сохранности качества (resources verbatim)**

Run:
```bash
cd poh-bft-writer
diff <(git -C "<scratchpad>/po-helper.git" show origin/main:.claude/skills/bft-writer/resources/hard_gates.md) skills/bft-writer/resources/hard_gates.md && echo "hard_gates VERBATIM"
grep -c "гейт" skills/bft-writer/resources/hard_gates.md
```
Expected: `hard_gates VERBATIM` (или отличия только в чистке путей CORTEX). 16 гейтов на месте.
Если в resources есть утечки (`CORTEX/_context-packs`, автор `Claude (bft-draft)`) — почистить их
и зафиксировать отдельным под-шагом, методологию не трогать.

- [ ] **Step 7: Commit**

```bash
cd poh-bft-writer
git add skills/bft-writer
git commit -m "refactor: decouple bft-writer skill from po-helper infra

Грудинг repoint CORTEX/Nexus → .bft/index/; удалён Backlog.md-раздел;
конфиг → bft-config. Практики качества (16 gates, Humanizer, Lessons
Learned, golden) — verbatim.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Декаплинг 7 core команд (context-gen читает индекс)

**Files:**
- Modify: `poh-bft-writer/commands/{bft-context-gen,bft-problem,bft-concept,bft-debate,bft-draft,bft-validate,bft-deliver}.md`

**Interfaces:**
- Consumes: skill bft-writer (Task 4), `.bft/index/` (Task 3).
- Produces: 7 команд каноничного пайплайна без связей po-helper.

- [ ] **Step 1: Verification-first**

После правок grep по всем 7 файлам не находит: `CORTEX`, `Nexus`, `People Graph`, `repowise`,
`domain-profile`, `bft_documentation/`, `sa_documentation`, `/bft-context-gen-deep`, `/bft-value`,
`/bft-ext-teams`, `/bft-constraints`, `{wiki.space}`, `{tracker.projects}`.

- [ ] **Step 2: `bft-context-gen.md` — repoint на индекс**

Заменить механику «читает CORTEX (локальные файлы vault) + один запрос к JIRA» на
«читает `.bft/index/` (architecture/domain-rules/decisions/glossary/stakeholders) + опц. один
запрос к JIRA по `<jira_key>`». Все 9 упоминаний `/bft-context-gen-deep` (см. spec) заменить:
рекомендацию углубления → «если индекс неполон (см. MANIFEST) — перезапусти `/bft-index` для
полного покрытия перед `/bft-problem`». Строку `Режим: БЫСТРЫЙ … Для полного разбора — 
/bft-context-gen-deep` → `Режим: контекст-пак из .bft/index/. Индекс неполон — /bft-index.`
Таблицу покрытия (`⚠️ /bft-context-gen-deep`) → `⚠️ /bft-index` (перестроить индекс).
Пути артефактов → `.bft/documentation/<epic>/artefacts/`.

- [ ] **Step 3: `bft-problem/concept/debate/draft/validate/deliver.md` — чистка связей**

По каждому файлу применить общие замены:

| Было | Стало |
|---|---|
| `CORTEX*` (пути/кортексы) | `.bft/index/` (соответствующий пак) |
| `Nexus` / `People Graph` / `repowise` | `.bft/index/stakeholders.md` / `architecture.md` |
| `bft_documentation/<epic>/` | `.bft/documentation/<epic>/` |
| `domain-profile.md` | `bft-config.md` |
| `{wiki.space}` / `{tracker.projects}` | `wiki_space` / `tracker_projects` из bft-config |
| ссылки на `/bft-value`,`/bft-ext-teams`,`/bft-constraints` | убрать или → соответствующий раздел индекса |

`bft-deliver.md`: публикация в Confluence — space из `wiki_space` (bft-config), не `{wiki.space}`.
Методологию стадий (роли, гейты, структуру БФТ v10) — не трогать.

- [ ] **Step 4: Проверка**

Run:
```bash
cd poh-bft-writer
grep -lnE "CORTEX|Nexus|People Graph|repowise|domain-profile|bft_documentation/|sa_documentation|bft-context-gen-deep|/bft-value|/bft-ext-teams|/bft-constraints|\{wiki\.space\}|\{tracker\.projects\}" commands/bft-context-gen.md commands/bft-problem.md commands/bft-concept.md commands/bft-debate.md commands/bft-draft.md commands/bft-validate.md commands/bft-deliver.md
```
Expected: пусто.

- [ ] **Step 5: Commit**

```bash
cd poh-bft-writer
git add commands/bft-context-gen.md commands/bft-problem.md commands/bft-concept.md commands/bft-debate.md commands/bft-draft.md commands/bft-validate.md commands/bft-deliver.md
git commit -m "refactor: decouple 7 core bft commands, ground on .bft/index

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Декаплинг bft-fast (skill + команда)

**Files:**
- Modify: `poh-bft-writer/skills/bft-fast/SKILL.md`, `poh-bft-writer/skills/bft-fast/resources/*.md`, `poh-bft-writer/commands/bft-fast.md`

**Interfaces:**
- Consumes: `.bft/index/` (опц., для грудинга), skill bft-writer (Sync-lane переиспользует /bft-draft+/bft-validate).
- Produces: автономный Fast-режим без связей po-helper.

- [ ] **Step 1: Verification-first**

Grep по bft-fast (skill+resources+command) не находит связей po-helper (тот же список токенов).
Особое внимание: `resources/deep_fork.md` (форк в Deep) и `extraction_schema.md`,
`requirements_table.md` (в них были cortex/domain-profile упоминания — см. spec grep).

- [ ] **Step 2: Почистить skill + resources**

Применить общие замены (как Task 5 Step 3) к `SKILL.md` и всем `resources/*.md`. `deep_fork.md`:
форк в Deep оставить, но источник глубокого контекста → `/bft-index` (не `context-gen-deep`).
`golden_*` examples — чистить только явные утечки путей, тексты-эталоны не переписывать.

- [ ] **Step 3: Почистить `commands/bft-fast.md`**

Убрать/заменить связи po-helper; артефакты → `.bft/documentation/`; конфиг → `bft-config.md`.

- [ ] **Step 4: Проверка**

Run:
```bash
cd poh-bft-writer
grep -rlnE "CORTEX|Nexus|People Graph|repowise|domain-profile|bft_documentation/|sa_documentation|context-gen-deep|\{wiki\.space\}|\{tracker\.projects\}|superset|paf" skills/bft-fast commands/bft-fast.md
```
Expected: пусто.

- [ ] **Step 5: Commit**

```bash
cd poh-bft-writer
git add skills/bft-fast commands/bft-fast.md
git commit -m "refactor: decouple bft-fast (v2 Fast lane)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Декаплинг bft-deep-swarm (skill + команда, repoint на /bft-index)

**Files:**
- Modify: `poh-bft-writer/skills/bft-deep-swarm/SKILL.md`, `skills/bft-deep-swarm/resources/*.md`, `poh-bft-writer/commands/bft-deep.md`

**Interfaces:**
- Consumes: `.bft/index/` (замена context-gen-deep), skill bft-writer (Sync через /bft-draft+/bft-validate).
- Produces: автономный Deep-режим; ось «ценность» inline; ruflo/swarm опционально.

- [ ] **Step 1: Verification-first**

Grep не находит связей po-helper. Ключевое: `resources/orchestration.md` строки про
`context: /bft-context-gen-deep` и `value: … bft-value`, `enrichment.md` про `Переиспользует
bft-value` — repoint (см. spec grep-находки).

- [ ] **Step 2: Repoint orchestration.md**

В `resources/orchestration.md`: шаг «context: /bft-context-gen-deep (канонический навык, уже
существует в репо …)» → «context: `/bft-index` (само-генерируемый индекс воркспейса; если
устарел — перезапустить). Per-source fallback: источник UNAVAILABLE → claim → `[УТОЧНИТЬ]`».
Шаг «value: … bft-value» → «value: ось 1 (enrichment.md §Ценность) — inline, без внешней команды».

- [ ] **Step 3: Repoint enrichment.md**

`enrichment.md` §Ценность: «Переиспользует bft-value» → «Ось ценности прорабатывается inline:
глубинные вопросы „зачем инвестировать“ + привязка к целям (из `.bft/index/decisions.md`,
если есть)».

- [ ] **Step 4: Почистить SKILL.md + ruflo опциональность + command**

`SKILL.md`, `deep_fork` связи, `grounding_verifier.md`, `eval_rubric.md`: применить общие замены.
ruflo/swarm — оставить как опциональную подложку с явной деградацией на нативные Claude-субагенты
(это уже в тексте — сохранить формулировку, убрать жёсткие пути po-helper). `commands/bft-deep.md`:
связи убрать, deep-контекст → `/bft-index`, артефакты → `.bft/documentation/`.

- [ ] **Step 5: Проверка**

Run:
```bash
cd poh-bft-writer
grep -rlnE "CORTEX|Nexus|People Graph|repowise|domain-profile|bft_documentation/|sa_documentation|context-gen-deep|bft-value|bft-constraints|bft-ext-teams|\{wiki\.space\}|\{tracker\.projects\}|superset|paf" skills/bft-deep-swarm commands/bft-deep.md
```
Expected: пусто.

- [ ] **Step 6: Commit**

```bash
cd poh-bft-writer
git add skills/bft-deep-swarm commands/bft-deep.md
git commit -m "refactor: decouple bft-deep-swarm, repoint deep-context to /bft-index

Разрешает конфликт зависимостей: context-gen-deep→/bft-index,
value→inline enrichment.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Финальный sweep + bootstrap-распознавание + demo dry-run

**Files:**
- Modify (при находках): любые файлы с остаточными связями po-helper.
- Create: `poh-bft-writer/skills/bft-writer/resources/` — без изменений; проверка.

**Interfaces:**
- Consumes: все предыдущие задачи.
- Produces: чистый репозиторий, проходящий HowToDemo dry-run.

- [ ] **Step 1: Полный sweep запрещённых токенов по всему репо**

Run:
```bash
cd poh-bft-writer
grep -rnE "CORTEX|Nexus|Нексус|People Graph|repowise|domain-profile|bft_documentation/|sa_documentation|\{wiki\.space\}|\{tracker\.projects\}|\{bft_store\}|superset|/paf|backlog task|--check-ac" commands/ skills/ README.md bft-config.template.md install.sh | grep -v "docs/"
```
Expected: пусто. Каждое совпадение — исправить по mapping предыдущих задач, закоммитить.

- [ ] **Step 2: Проверка полноты — 10 команд, 4 навыка**

Run:
```bash
cd poh-bft-writer
ls commands/ | grep -c "^bft-.*\.md$"   # ждём 10
ls -d skills/*/ | wc -l                  # ждём 4
for s in bft-indexer bft-writer bft-fast bft-deep-swarm; do test -f "skills/$s/SKILL.md" && echo "$s OK"; done
```
Expected: `10`, `4`, все `OK`.

- [ ] **Step 3: Проверка практик качества на месте (criterion 6)**

Run:
```bash
cd poh-bft-writer
grep -c "гейт" skills/bft-writer/resources/hard_gates.md          # ≥16
test -f skills/bft-writer/resources/writing_style.md && echo "Humanizer OK"
test -f skills/bft-writer/resources/review_feedback.md && echo "Lessons Learned OK"
test -f skills/bft-writer/examples/golden_bft_example.md && echo "golden OK"
grep -c "ЗМ-" skills/bft-writer/resources/review_feedback.md      # правила-уроки на месте
```
Expected: ≥16, все OK, число ЗМ ≥ 1.

- [ ] **Step 4: install.sh dry-run (HowToDemo 1-2)**

Run:
```bash
cd poh-bft-writer
T=$(mktemp -d); cp -R commands skills bft-config.template.md install.sh "$T"/
cd "$T" && echo "1" | bash install.sh >/dev/null 2>&1
echo "cmds: $(ls .claude/commands/ | grep -c bft-)  skills: $(ls -d .claude/skills/*/ | wc -l)"
head -1 .claude/skills/bft-indexer/SKILL.md
```
Expected: `cmds: 10  skills: 4`; frontmatter-строка `---` или существующий заголовок.

- [ ] **Step 5: bootstrap-распознавание «Установи bft-writer»**

Добавить в README раздел «Для ИИ-помощника» (bootstrap-инструкция), чтобы фраза распознавалась:

```markdown
## Для ИИ-помощника (bootstrap)
Если пользователь просит «Установи bft-writer»: (1) запусти `curl -ksSL <repo>/install.sh | bash`
или склонируй и запусти `install.sh`, выбрав IDE-агента пользователя; (2) после синка — сразу
запусти `/bft-index` для первичной аналитики воркспейса; (3) покажи MANIFEST-покрытие и предложи
`/bft-context-gen`.
```

Commit README.

- [ ] **Step 6: HowToDemo walkthrough (ручная сверка 6 критериев)**

Пройти по spec §HowToDemo, отметить каждый критерий против артефактов:
1. README curl + bootstrap-раздел ✓
2. install.sh → 10 команд ✓
3. `/bft-index` + bft-indexer ✓
4. 7-стадийный пайплайн (bft-writer + 7 команд) ✓
5. `/bft-fast` + `/bft-deep` ✓
6. hard_gates(16)+writing_style+review_feedback+golden verbatim ✓

Записать результат сверки в коммит-месседж.

- [ ] **Step 7: Final commit**

```bash
cd poh-bft-writer
git add -A
git commit -m "chore: final decoupling sweep + HowToDemo verification

Все 6 критериев HowToDemo пройдены; ноль связей po-helper.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (выполнено при написании плана)

**Spec coverage:**
- HowToDemo 1 (установка) → Task 1 (README/curl) + Task 2 (install.sh) + Task 8 Step 5 (bootstrap). ✓
- HowToDemo 2 (команды) → Task 2 + Task 8 Step 2. ✓
- HowToDemo 3 (само-контекст) → Task 3 (bft-indexer/`/bft-index`). ✓
- HowToDemo 4 (step-by-step workflow) → Task 4 + Task 5. ✓
- HowToDemo 5 (v2 fast+deep) → Task 6 + Task 7. ✓
- HowToDemo 6 (качество po-helper) → Global Constraint verbatim + Task 4 Step 6 + Task 8 Step 3. ✓
- Индекс-схема (spec §Индекс) → Task 3. ✓
- Декаплинг (spec §Декаплинг) → Tasks 4-8 грепы. ✓
- Дистрибуция install.sh (spec §Дистрибуция) → Task 2. ✓
- Разрешение конфликта deep-зависимостей (spec §v2) → Task 7. ✓

**Открытые вопросы спеки — решения в плане:**
- plugin.json → не делаем (только install.sh); в scope не входит.
- gitignore индекса → `.bft/` в .gitignore (Task 0 done).
- serena-онбординг → делает агент при `/bft-index` (Task 3 SKILL: «если serena подключена»), не install.sh.

**Placeholder scan:** новые артефакты (README, install.sh, bft-config, bft-index, bft-indexer,
index_schema) даны полным содержимым. Port-задачи (4-7) заданы grep-mapping + проверками, т.к.
точные строки зависят от переносимых файлов; каждая — с verification-grep. Это осознанный
формат для авторинга prompt-файлов, не placeholder.

**Type consistency:** пути (`.bft/index/`, `.bft/documentation/<epic>/`), ключи конфига
(`tracker_projects`,`wiki_space`,`source_globs`,`docs_path`,`index_path`), имена паков —
согласованы между Task 1 (config), Task 3 (schema), Task 4-7 (repoint mapping).
```
