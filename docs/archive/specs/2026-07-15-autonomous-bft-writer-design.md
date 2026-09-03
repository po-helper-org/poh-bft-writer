---
title: poh-bft-writer — автономный генератор БФТ
date: 2026-07-15
status: draft
---

# poh-bft-writer — автономный генератор БФТ

## Цель

Отдельный репозиторий-навык, который качественно генерирует БФТ (бизнес-функциональные
требования). Взят за основу BFT-слой po-helper, изолирован в самодостаточный продукт
**без единой зависимости от po-helper** (CORTEX, Nexus, People Graph, repowise, backlog-доска,
domain-profile, superset/paf). Подключается в любой воркспейс и сам строит себе контекст.

Не замена методологии po-helper — перенос её качества в переносимый, drop-in формат.

## HowToDemo (acceptance criteria)

Демо-сценарий, по которому проект считается готовым:

1. **Установка одной фразой/командой.** Пользователь говорит ИИ-помощнику «Установи bft-writer»
   ИЛИ копирует `curl … | bash` из README. Оба пути ставят навык в текущий репозиторий.
2. **Команды доступны.** После установки в воркспейсе работают команды `/bft-*`.
3. **Само-контекст при установке.** bft-writer проводит первичную аналитику воркспейса и
   создаёт себе контекст (индекс) без ручной настройки источников.
4. **Полный step-by-step workflow.** Каноничный пайплайн из 7 стадий с STOP-паузами
   (human-in-the-loop).
5. **v2 workflow.** Автономные режимы `fast` + `deep` (ноль STOP, `[УТОЧНИТЬ]`-маркеры).
6. **Качество = po-helper.** Результат соответствует всем отлаженным в po-helper практикам БФТ:
   16 hard gates, стиль/голос (Humanizer), Lessons Learned (review_feedback), корп-шаблон MTS v10,
   ранги якорей, CATWOE, adversarial-дебаты, golden-референсы.

## Принцип изоляции

**Меняем источник грудинга, сохраняем методологию.** Все ресурсы качества переносятся
**verbatim** (hard_gates, bft_standards, writing_style, review_feedback, anchor_rules, catwoe,
debate_rules, examples/golden_*). Изменяется только то, **откуда** пайплайн берёт факты:
раньше CORTEX/Nexus/People Graph → теперь само-генерируемый индекс воркспейса + live-MCP
(JIRA/Confluence) как опция.

Нулевой допуск к галлюцинациям сохраняется: каждый факт → якорь-источник
(`.bft/index/...`, `file:line`, JIRA-key, Confluence-URL). Нет источника → `[УТОЧНИТЬ у {кого}]`.

## Архитектура

### Бэкенд индексации: нативная файловая (решение B)

Никакого сервера БД (Neo4j отклонён — инфра-трение против «подключить куда угодно»).
Индекс = markdown-пакеты в воркспейсе. Семантика кода — через serena MCP (если код есть).

### Структура репозитория

```
poh-bft-writer/
├── .claude-plugin/plugin.json     # опц., если решим и Claude-plugin (сейчас — нет)
├── install.sh                     # мульти-агент установщик (адаптация sa-helper)
├── README.md                      # curl-команда + HowToDemo + быстрый старт
├── bft-config.template.md         # ключи трекера, wiki space, source-globs
├── commands/                      # 10 команд
│   ├── bft-index.md               # NEW: первичная аналитика/индексация
│   ├── bft-context-gen.md
│   ├── bft-problem.md
│   ├── bft-concept.md
│   ├── bft-debate.md
│   ├── bft-draft.md
│   ├── bft-validate.md
│   ├── bft-deliver.md
│   ├── bft-fast.md
│   └── bft-deep.md
├── skills/
│   ├── bft-indexer/               # NEW: логика само-индексации
│   ├── bft-writer/                # каноничный пайплайн (перенос verbatim + repoint грудинга)
│   ├── bft-fast/                  # v2 Fast
│   └── bft-deep-swarm/            # v2 Deep
└── docs/specs/                    # этот документ
```

### Индекс воркспейса (`.bft/index/`)

`/bft-index` (роль: Context Builder) сканирует источники, автодетект:
- **Доки** — glob из bft-config (`*.md/*.pdf/*.docx`): продукт-доки, старые БФТ, Confluence-экспорты.
- **Код** — serena MCP (As-Is якоря), если репозиторий с кодом.
- **Трекер** — JIRA/Confluence MCP (Atlassian), если подключён; иначе пропускается.

Выход — само-генерируемый CORTEX-эквивалент:

```
.bft/index/
├── MANIFEST.md        # покрытие, свежесть (дата), какие источники доступны/пропущены
├── architecture.md    # C1: компоненты, системы, интеграции
├── domain-rules.md    # C2: бизнес-правила
├── decisions.md       # C5: ADR / решения PO
├── regulatory.md      # C3: compliance/регуляторика (опц.)
├── glossary.md        # лексикон домена
├── stakeholders.md    # люди/команды (замена People Graph)
└── sources.md         # реестр якорей: путь / file:line / JIRA-key / Confluence-URL
```

Правило: пусто ≠ «нет данных». Недоступный источник → в MANIFEST помечен UNAVAILABLE,
claim оттуда → `[УТОЧНИТЬ]`.

### Пайплайн — каноничный (workflow step-by-step, criterion 4)

7 стадий, STOP после каждой (human-in-the-loop). Грудинг **index-first, MCP-fallback**:

```
/bft-index        → .bft/index/            [СТОП: PO смотрит покрытие]  (или авто при установке)
/bft-context-gen  → context-pack           [СТОП]   (быстрый пак из индекса)
/bft-problem      → problem.md             [СТОП]
/bft-concept      → concept.md             [СТОП]
/bft-debate       → вердикт в concept.md
/bft-draft        → <epic>.md (БФТ)        [СТОП]
/bft-validate     → validation.md (16 gates + Светофор)
/bft-deliver      → публикация (JIRA+Confluence)  [СТОП: сухой прогон]
```

Артефакты эпика → `.bft/documentation/<epic>/` (было `bft_documentation/` в po-helper).

### Пайплайн — v2 автономный (criterion 5)

- `/bft-fast` — Fast lane: письмо-seed → быстрый черновик БФТ. Ноль STOP, `[УТОЧНИТЬ]`-маркеры.
- `/bft-deep` — Deep swarm: обогащение по осям (ценность / what-if демо / границы).
  **Разрешение старого конфликта:** deep переиспользует `/bft-index` как источник глубокого
  контекста (вместо выкинутого `context-gen-deep`); ось «ценность» — inline в enrichment
  (вместо выкинутого `bft-value`). ruflo/swarm-подложка — опциональна, деградирует на
  нативные Claude-субагенты.

### Установка + само-контекст (criteria 1–3)

**Путь A — «Установи bft-writer» (агент-оркестровка):** ИИ-помощник распознаёт фразу,
клонирует/синкает файлы через install.sh, затем **сам запускает `/bft-index`** — первичная
аналитика воркспейса. Bootstrap-инструкция лежит в README + распознаётся навыком.

**Путь B — curl из README (скрипт-оркестровка):** `install.sh` синкает commands+skills в корень
выбранного IDE-агента, в конце печатает следующий шаг: «запусти `/bft-index` для построения
контекста». LLM-аналитику скрипт не выполняет (это работа агента).

`install.sh` (адаптация sa-helper): выбор IDE-агента (Claude `.claude/` / Codex `.agents/` /
Cline `.clinerules/` / DevX / Universal), синк управляемых подпапок, инъекция frontmatter
(`name` + `description`) в SKILL.md. Существующие файлы не трёт.

### Декаплинг от po-helper (чистка при переносе)

Вырезать/заменить во всех перенесённых файлах:
- CORTEX-пути (`CORTEX/_context-packs/…`), кортексы C1/C3/C5 как внешняя база → индекс `.bft/index/`.
- Nexus / People Graph / repowise → индекс (`stakeholders.md`, `architecture.md`).
- § «Синхронизация с доской Backlog.md» в bft-writer/SKILL.md → удалить (операционная инфра po-helper).
- `domain-profile.md`, `{wiki.space}`, `{tracker.projects}`, `{bft_store}` → `bft-config.md`.
- Пути `bft_documentation/`, `sa_documentation/`, superset/paf-упоминания → `.bft/…`.
- Мягкие ссылки на выкинутые команды (`/bft-value`, `/bft-ext-teams`, `/bft-constraints`,
  `/bft-context-gen-deep`) → переписать на `/bft-index` или убрать.

**Не трогать (качество, criterion 6):** hard_gates.md, bft_standards.md, writing_style.md,
review_feedback.md, anchor_rules.md, catwoe.md, debate_rules.md, examples/golden_*,
examples/ideal_bft.md — переносятся verbatim, чистятся только явные утечки лесов инструмента.

## Границы (scope)

**Входит:** индексатор, 10 команд, 4 навыка, install.sh, README, bft-config.template, декаплинг.

**Не входит:** Neo4j/kuzu графовый бэкенд; собственный MCP-сервер; выкинутые команды
constraints/ext-teams/value/context-gen-deep как отдельные стадии (их функции поглощены
индексом и deep-enrichment); публикация репо на GitHub (пока локально).

## Открытые вопросы

- Claude-plugin.json — оставить как второй канал дистрибуции или только install.sh? (сейчас: только install.sh)
- Расположение индекса `.bft/` — gitignore по умолчанию или коммитить? (предложение: gitignore, юзер решает)
- serena-онбординг воркспейса — install.sh настраивает `.serena/project.yml` или делает агент при `/bft-index`?
