# Скелет документов blueprint (document_assembly.md)

Единственный источник формы `<epic_slug>-story.md` (история через экраны, первый этап — §«История»), проекта карты `<epic_slug>-blueprint/` (второй этап — §«Карта», проект Backlog.md) и прежней слоевой схемы `<epic_slug>-blueprint.md`. Формат — markdown-таблицы, как весь БФТ: документ ревьюится глазами и публикуется в Confluence без конвертации. Разбирает его `scripts/bft_blueprint.py`; форму держит линтер `bft-blueprint-lint.py`.

## Путь файлов

Рядом с БФТ, в каталоге эпика: `<docs_path>/<epic_slug>/`.

| Файл | Что | Кто пишет |
|---|---|---|
| `<epic_slug>-story.md` | история через экраны — верхняя линия, источник правды | ты |
| `<epic_slug>-story.html` | страница истории: ряды персонажей слева направо, подробности шага, рассказ по шагам, открытые вопросы | `bft-story-render.py` |
| `<epic_slug>-blueprint/` | карта инициативы — проект Backlog.md, источник правды: задачи «Что делаем», карточки «Как это работает», документы «Карта», «История», требования к экранам (`resources/backlog_rules.md`) | ты, через CLI `backlog` |
| `<epic_slug>-map.html` | страница карты: что видят, что делаем, как это работает; постановки задач, карточки, требования к экранам, замечания | `bft-backlog-build.py` |
| `<epic_slug>-blueprint.zip` | автономная папка проекта целиком и страница `blueprint.html` | `bft-backlog-build.py` |
| `<epic_slug>-blueprint.md` | прежняя слоевая схема (режим `--layers`) | ты |
| `<epic_slug>-blueprint.html` | страница ревью: образ результата, диаграмма, «что реализовать по слоям», покрытие требований, список `[УТОЧНИТЬ]` | `bft-blueprint-render.py` |
| `<epic_slug>-blueprint.svg` | диаграмма отдельной картинкой для Confluence | `bft-blueprint-render.py` |

`.html` и `.svg` руками не правятся: следующая сборка перезапишет их из `.md`.

## Frontmatter

Восемь ключей:

| Ключ | Правило |
|---|---|
| `epic_slug` | слаг эпика, как в БФТ |
| `stage` | всегда `blueprint` |
| `source_doc` | путь к БФТ **относительно этого файла**: `<epic_slug>.md` (или `<epic_slug>-fast.md`) |
| `source_stage` | `deep` или `fast` — стадия БФТ, по которой собрано |
| `source_rev` | первые 12 знаков sha1 файла БФТ: `sha1sum <БФТ> \| cut -c1-12`. Линтер сверяет и предупреждает `BP020`, когда БФТ ушёл вперёд |
| `version` | `1` при сборке, +1 за каждую правку |
| `revised` | дата последней правки, `YYYY-MM-DD` |
| `status` | `Черновик`; `Согласован` ставит PO |

## Заголовок и разделы

```
# [Blueprint] <epic_slug>: <название инициативы из БФТ>
```

Разделы `##` строго в этом порядке. В каждом ровно одна таблица, заголовок колонок байт-в-байт:

```
## Образ результата
| Поле | Значение |
Строки: «Выгода на витрине», «Кто получает», «Где видна» — все три обязательны.

## Стадии
| ID | Стадия | Из сценария |
ID: С1…С8 (кириллическая С). «Из сценария» — шаг How to demo или раздел БФТ, откуда стадия.

## Дорожки
| ID | Слой | Название | Команда / система |
Слой: сервис или основа. Хотя бы одна дорожка сервис.

## Карточки
| ID | Слой | Дорожка | Стадия | Что должно работать | Требования | Статус |

## Связи
| Откуда | Куда | Тип |
```

Образ результата:

- **Выгода на витрине** — одно предложение: что получает клиент и где. Из S блока «Цель» и БТ.
- **Кто получает** — из ДЛЯ КОГО «Проблемы». Если выгоду получает не только клиент (например, контент-менеджер), назови обоих.
- **Где видна** — экран, страница, канал: из ИТ и «Плана демонстрации».

Других разделов нет: ни «Открытых вопросов», ни «Допущений» (ЗМ-020). Вопрос уходит в чат, а в таблице остаётся `[УТОЧНИТЬ у {кого}]` в карточке. Покрытие требований в документе не хранится: страница считает его из карточек и БФТ, чтобы оно не разъезжалось с диаграммой.

## Проверка перед записью

```bash
python3 <skills_path>/bft-blueprint/scripts/bft-blueprint-lint.py <docs_path>/<epic_slug>/<epic_slug>-blueprint.md
python3 <skills_path>/bft-writer/scripts/bft-style-lint.py <docs_path>/<epic_slug>/<epic_slug>-blueprint.md
```

Ненулевой код — исправить и прогнать снова. Только после этого `bft-blueprint-render.py`. Рендерер сам прогоняет линтер и по сломанному документу файлов не пишет.

## История

`<epic_slug>-story.md` собирается первым и согласуется с PO до слоёв. Разбирает его `scripts/bft_story.py`, форму держит `bft-story-lint.py`, смысл карточек — `story_line.md`, вопросы — `story_interview.md`. Эталон — `examples/golden_story.md`.

Frontmatter — те же восемь ключей, что у blueprint, но `stage: story`; `status: Согласован` ставит PO, и только после этого собираются слои.

```
# [История] <epic_slug>: <название инициативы из БФТ>

## Этапы
| ID | Этап | Когда |
ID — латинская буква A…H по порядку. «Когда» — момент пути или прочерк.

## Персонажи
| ID | Персонаж | Дорожка | Было | Стало | Источник |
ID — латиница-слаг (guest, rest). «Было» и «Стало» — крупное число и подпись через «·»: `<1% · узнавали о скидке`; нет числа в БФТ — прочерк.

## Шаги
| ID | Персонаж | Этап | Заголовок | Пояснение | Экраны | Раньше | Источник |
ID — Ш1, Ш2… сквозные. Этап — ID этапа, `было`, `стало` или диапазон `B–E` (полоса ожидания, без экранов).
Шаги персонажа идут подряд и слева направо: было → шаги → стало. Экраны — ID через запятую, до двух.

## Экраны
| ID | Контур | Устройство | Вид | Состав | Источник |
ID — буква этапа и номер (B1, F3). Устройство: браузер | письмо | уведомление | приложение.
Вид: основной | альтернативный | неизвестен. Состав — элементы через `;` (story_line.md §«Состав экрана»).

## Вопросы
| ID | Кому | Вопрос | Где | Ответ |
ID — В1, В2… «Где» — ID шага или экрана. «Ответ» — текст и `(PO, YYYY-MM-DD)` или прочерк, пока открыт.
```

«Вопросы» — единственное отличие от правила ЗМ-020 «вопросы — в чат, не в документ». История — не БФТ, а рабочая схема: красная точка на экране должна держаться за вопрос между прогонами, а ответ остаётся опорой шага. Тот же список «кому — что» всё равно уходит PO в чат на STOP; в БФТ не пишется ничего.

```bash
python3 <skills_path>/bft-blueprint/scripts/bft-story-lint.py <docs_path>/<epic_slug>/<epic_slug>-story.md
python3 <skills_path>/bft-writer/scripts/bft-style-lint.py <docs_path>/<epic_slug>/<epic_slug>-story.md
python3 <skills_path>/bft-blueprint/scripts/bft-story-render.py <docs_path>/<epic_slug>/<epic_slug>-story.md
```

## Карта

Карта собирается после согласованной истории — проектом Backlog.md `<epic_slug>-blueprint/` рядом с историей. Создаёт его `bft-backlog-init.py`, разбирает `scripts/bft_backlog.py`, форму и смысл держит `bft-backlog-lint.py` по `resources/backlog_rules.md`. Эталон — `examples/dineclub-restart-blueprint/`.

```
<epic_slug>-blueprint/
  README.md, CLAUDE.md, AGENTS.md, GEMINI.md   инструкции агенту: что где лежит, правила, команды
  backlog.py, blueprint.py                 встроенный CLI Backlog.md и сборка: только python3
  .blueprint/scripts, .blueprint/rules     скрипты сборки и правила карты; .claude/settings.json — разрешения
  backlog/config.yml                       task_prefix: "bp"
  backlog/docs/doc-1 - Карта.md            <!-- bft-map паспорт -->, «Команды», «Вопросы»
  backlog/docs/doc-2 - История.md          <!-- bft-story frontmatter истории -->, история целиком
  backlog/docs/screens/doc-N - F3 · ….md   требования к экрану (resources/screen_notes.md)
  backlog/tasks/bp-N - ….md                «Что делаем»: stage:…, вид, @команда, постановка, критерии приемки
  backlog/tasks/bp-N.M - ….md              «Как это работает»: stage:…, layer:…, суть, UserStory, JobStory, Параметры, Процесс, BPMN, HowToDemo
```

Паспорт «Карты» — семь ключей: `epic_slug`, `source_doc`, `source_stage`, `source_rev`, `version`, `revised`, `status`.

```bash
python3 <skills_path>/bft-blueprint/scripts/bft-backlog-init.py <docs_path>/<epic_slug>/<epic_slug>-story.md
python3 <skills_path>/bft-blueprint/scripts/bft-backlog-lint.py <docs_path>/<epic_slug>/<epic_slug>-blueprint --source <docs_path>/<epic_slug>/<epic_slug>.md
python3 <skills_path>/bft-blueprint/scripts/bft-backlog-build.py <docs_path>/<epic_slug>/<epic_slug>-blueprint --source <docs_path>/<epic_slug>/<epic_slug>.md
```
