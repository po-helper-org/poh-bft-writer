---
description: 'V2 БФТ-Обогатитель — берёт seed (Fast-черновик или Summary) и автономно наращивает глубину (ценность/what-if/границы) + синк в канон (роль: Обогатитель)'
---

## Использование
```
/bft-deep <seed> [epic_slug]
```
- `<seed>` — путь к Fast-черновику (письмо bft-fast) или к Summary/контексту.
- `[epic_slug]` — опц.; нет → date-slug из темы.

## Важно
Роль — Обогатитель (V2). Берёт основу, наращивает глубину, укладывает в канон-структуру MTS. Стоп на валидированном черновике; `/bft-deliver` — отдельный ручной шаг PO. Факт без источника → `[УТОЧНИТЬ]`.

## Инструкция для LLM
1. Загрузить `skills/bft-deep-swarm/SKILL.md` + resources (orchestration/enrichment/grounding_verifier/eval_rubric).
2. Резолв конфига (SKILL.md §Резолв).
3. Прогнать оркестрацию `resources/orchestration.md` стадии 0-11 (стадия context — `/bft-index`; если индекс `.bft/index/` устарел или неполон по теме, перезапустить `/bft-index` перед этой стадией).
4. Emit: `.bft/documentation/<epic_slug>/<epic_slug>.md` (путь из `docs_path`, дефолт `.bft/documentation`; резолв — SKILL.md §Резолв конфига) + artefacts/ + нотификация.
