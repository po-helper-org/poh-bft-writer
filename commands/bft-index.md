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
