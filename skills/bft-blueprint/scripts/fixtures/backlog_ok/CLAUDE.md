
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

<!-- BFT-BLUEPRINT START -->
## Service Blueprint

Проект — карта инициативы «Скидка по билету» (эпик `demo-story`), собранная по БФТ `story_source.md`. Карта — это задачи и документы Backlog.md:

- **Что делаем** — задачи с меткой `stage:<этап>`: исполнитель — команда (`@gds`), описание — постановка для техлида, критерии приемки — чеклист;
- **Как это работает** — их подзадачи с меткой `layer:employee|technology|backstage|support`: параметры IDEF0, схема, HowToDemo;
- **документы** — «Карта» (команды и вопросы), «История» (этапы, шаги, экраны), `screens/` — требования к экранам для дизайнера.

Правила — `.blueprint/rules/backlog_rules.md`. Факты — только из БФТ; чего в нём нет — `[УТОЧНИТЬ у {кого}]` и строка в «Вопросах» документа «Карта». Задачи и документы правь только через CLI `backlog`. Блок IDEF0 не пиши: его собирает сборка из «Параметров».

После правок — из папки проекта:

```bash
python3 .blueprint/scripts/bft-backlog-lint.py .
python3 .blueprint/scripts/bft-backlog-build.py . --out-dir .
```

Сборка пишет страницу карты `demo-story-map.html` и архив проекта `demo-story-blueprint.zip`. Скрипты — только стандартная библиотека Python; в навыке они лежат в `<skills_path>/bft-blueprint/scripts/`.
<!-- BFT-BLUEPRINT END -->
