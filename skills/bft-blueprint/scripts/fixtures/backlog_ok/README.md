# Скидка по билету

Service Blueprint инициативы `demo-story` — проект [Backlog.md](https://github.com/MrLesk/Backlog.md). Доска: `backlog board` или `backlog browser`; страница карты — `blueprint.html` в архиве или `demo-story-map.html` после сборки.

<!-- BFT-BLUEPRINT START -->
## Service Blueprint

Проект — карта инициативы «Скидка по билету» (эпик `demo-story`), собранная по БФТ `story_source.md`. Карта — это задачи и документы Backlog.md:

- **Что делаем** — задачи с меткой `stage:<этап>`: исполнитель — команда (`@teama`), описание — постановка для техлида, критерии приемки — чеклист;
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
