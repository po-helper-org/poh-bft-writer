---
description: 'Отгрузка БФТ — публикация в JIRA+Confluence, связывание артефактов (роль: Deliverer). Сухой прогон → ок PO → запись'
---

## Использование

```
/bft-deliver <epic_code> [bft_space] [bft_parent_id] [project]
```

**Параметры:**
- `<epic_code>` — короткий код БФТ (напр. `EPIC-10`, `EPIC-FAQ`). По нему находится финальный БФТ в папке эпика: `.bft/documentation/<epic_code>/<epic_code>.md` (куда его сохраняет `/bft-draft`).
- `[bft_space]` — Confluence space для публикации БФТ команды API-слой. **Дефолт — `wiki_space` из `bft-config.md`.**
- `[bft_parent_id]` — parent page для БФТ-страницы (опц.). Если не задан → `[УТОЧНИТЬ у PO]`.
- `[project]` — JIRA-проект для создания Эпика. **Дефолт — первый проект из `tracker_projects` (`bft-config.md`).**

## Примеры

```
/bft-deliver EPIC-10
/bft-deliver EPIC-10 {wiki_space} {bft_parent_page_id}
/bft-deliver EPIC-FAQ {wiki_space} {bft_parent_page_id} PROJ2
```

## Важно

**Роль: Deliverer.** Финальная стадия pipeline после `/bft-validate` (итог 🟢/🟡). Берёт **валидный** черновик БФТ и публикует 4 артефакта: JIRA Эпик + 2 страницы Confluence + связи между ними.

> Аналог sa-helper: нет прямого; это финал публикации после `/validate-doc`.

**Анти-правило (приоритет):** JIRA и Confluence — **только чтение до явного «ок» PO**. Поэтому команда работает в 2 такта:
1. **Сухой прогон** — собирает preview всех 4 артефактов БЕЗ записи, выводит STOP.
2. После «ок» PO — **выполняет 4 шага подряд**, захватывая ID каждого артефакта для связывания.

**Принципы:**
- Источник содержимого — **только валидный черновик БФТ** из папки эпика. Не выдумывай факты заново.
- `{bft_parent_page_id}` — родительская страница «краткого сутевого описания запроса» (из `bft-config.md`, опционально; не задано → `[УТОЧНИТЬ у PO]`).
- Каждый шаг захватывает ID (epicKey, pageId) → передаёт на шаг связывания. **Последовательно, не параллельно.**
- VPN/Confluence/JIRA недоступны → честно `[УТОЧНИТЬ: MCP недоступен]`, не эмулировать успех.
- **Ссылки Jira/Confluence → макросы Confluence (ЗМ-009).** На публикуемых страницах каждое упоминание Jira/Confluence отдаётся макросом для быстрого доступа и превью, а не голой markdown-ссылкой (см. «Конвертация ссылок в макросы» ниже). Ссылка ведёт только на **существующую** страницу; несуществующее (эпик ещё не создан) не превращать в битую ссылку.

---

## Инструкция для ЛLM

### ТАКТ 1. СУХОЙ ПРОГОН (без записи)

#### Этап 1: Загрузка входов
1. Найди финальный БФТ: `.bft/documentation/<epic_code>/<epic_code>.md` (корень папки эпика, куда его кладёт `/bft-draft`). Если нет → СТОП:
   ```
   🔴 Финальный БФТ <epic_code> не найден: .bft/documentation/<epic_code>/<epic_code>.md.
   → /bft-draft <epic_code>, затем /bft-validate <epic_code>.
   ```
2. Проверь `validation.md` (в `.bft/documentation/<epic_code>/artefacts/`). Если есть 🔴 в Hard Gates → СТОП, отгрузка запрещена:
   ```
   🔴 БФТ <epic_code> не прошёл валидацию (есть 🔴 в Hard Gates).
   → /bft-draft <epic_code> (исправить), затем /bft-validate.
   ```
3. Прочитай `problem.md` + `concept.md` (если есть) — для краткой выжимки.
4. Зафиксируй параметры: `epic_code`, `bft_space` (дефолт = `wiki_space` из `bft-config.md`), `bft_parent_id`, `project` (дефолт = первый проект из `tracker_projects` в `bft-config.md`).
5. **Проверка ссылок (ЗМ-009).** Собери все упоминания Jira/Confluence из черновика. Где MCP доступен — подтверди существование каждой: Jira-ключ → `jira_get_issue`; Confluence pageId → `confluence_get_page`. Несуществующее/невалидное **не публиковать ссылкой** — понизь до `[УТОЧНИТЬ]` или пометки без URL и вынеси в STOP-отчёт. Ссылки только на существующие страницы.

#### Этап 2: Сборка preview 4 артефактов

**Превью 1 — JIRA Эпик** (project=`<project>`):
- `summary`: название БФТ (из H1 черновика, без префикса `[БФТ]`).
- `issue_type`: `Epic`. Если тип в проекте называется иначе → пометь `[УТОЧНИТЬ: issue_type Epic в <project>]`.
- `description`: из раздела «Бизнес описание» + ключевые БТ + ссылка на полный БФТ (placeholder, ссылку подставишь на шаге связывания). Markdown.
- `labels`: `bft`, `epic_code`.
- Доп. поля: priority/assignee только если явно есть в черновике, иначе не выдумывать.

**Превью 2 — Дочерняя страница «краткое сутевое описание»** (parent=`{bft_parent_page_id}`):
- `title`: `<epic_code>: <Название БФТ> — краткое описание запроса`.
- `body` — **выжимка** (не копия всего БФТ):
  - Суть запроса: 2-3 предложения (из «Бизнес описание»).
  - As-Is → Gap (из problem.md, 2-4 строки).
  - Образ результата (из концепта/БТ, 1-2 пункта).
  - Ключевые ФТ (3-5 шт, верхнеуровнево).
  - Плейсхолдеры: `[Эпик: подставится]`, `[Полный БФТ: подставится]`.
- `content_format`: markdown.

**Превью 3 — Страница БФТ команды API-слой** (space=`<bft_space>`, parent=`<bft_parent_id>`):
- **Сначала прочитать `pageId`/`source` из frontmatter документа.** Есть `pageId` (не `pending`) → режим **UPDATE**: страница уже создана `/bft-fast` и обогащена `/bft-deep`, публикуем финальную версию в неё, **новую страницу не создаём**. Нет `pageId` или `pending` → режим **CREATE** (как раньше). Режим показать в сухом прогоне явной строкой: `режим: UPDATE pageId=<id>` или `режим: CREATE (страница ещё не создана)`.
- `title`: `[БФТ] <epic_code>: <Название>` (как H1 черновика).
- `body`: **полное содержимое** файла `.bft/documentation/<epic_code>/<epic_code>.md` (frontmatter убери, остальное 1:1 — PlantUML-блоки сохраняй как есть).
- Если `bft_parent_id` не задан → пометь `[УТОЧНИТЬ у PO: parent page для БФТ в space <bft_space>]`, СТОП.
- `content_format`: markdown.

**Превью 4 — План связей** (связать всё с JIRA Эпиком):
- Remote link: `epicKey` ↔ `pageId 2` (краткое описание).
- Remote link: `epicKey` ↔ `pageId 3` (полный БФТ).
- В тексты страниц 2 и 3 подставить `epicKey` (зависит от шага 1).

#### Этап 3: Вывод preview + STOP

```
── СУХОЙ ПРОГОН ОТГРУЗКИ БФТ <epic_code> ──
Записи не было. Параметры: project=<project>, bft_space=<bft_space>, summary_parent={bft_parent_page_id}, bft_parent=<bft_parent_id|TBD>.

▸ АРТЕФАКТ 1 — JIRA Эпик (<project>)
   summary: ...
   issue_type: Epic
   description: <превью>

▸ АРТЕФАКТ 2 — Дочерняя страница «краткое описание» (parent {bft_parent_page_id})
   title: ...
   body: <превью выжимки>

▸ АРТЕФАКТ 3 — Страница БФТ (space <bft_space>, parent <bft_parent_id>)
   title: ...
   body: <полный БФТ из папки эпика, N символов>

▸ АРТЕФАКТ 4 — Связи
   epicKey ↔ [страница 2], epicKey ↔ [страница 3]

▸ ССЫЛКИ — формат публикации: <storage|wiki|markdown>; Jira/Confluence → макросами (превью)
   проверка существования: <N ок / M не найдено → понижены до [УТОЧНИТЬ]>

── СТОП ──
PO: подтверди «ок» (или поправь параметры) → выполню все 4 шага с записью.
Без «ок» — ничего не публикую.
```

---

### Конвертация ссылок в макросы Confluence (ЗМ-009)

Публикуемые страницы (Шаги 2–3) отдают Jira/Confluence-упоминания **макросами**, чтобы PO из документа сразу видел превью и статус. Выбор `content_format`:
- **`storage`** — макросы как XHTML (надёжно для Jira-макроса). Публикуй тело в storage-формате, заменив ссылки:
  - Jira: `[JIRA GDSLV-1610](…)` → `<ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">GDSLV-1610</ac:parameter></ac:structured-macro>`
  - Confluence-страница: → `<ac:link><ri:page ri:content-title="<Заголовок>"/></ac:link>` (или макрос `include`/`excerpt-include` для превью содержимого).
- **`wiki`** — легче совмещать макросы с таблицами/текстом:
  - Jira: `{jira:key=GDSLV-1610}` · Confluence: `[<Заголовок страницы>]` или `{include:<Space>:<Заголовок>}`.

Списки внутри ячеек таблиц (ПРОБЛЕМА/TOBE и т.п., ЗМ-011) — настоящим `<ul><li>…</li></ul>` (в `storage` — как есть; в `wiki` — списком, не `•`), чтобы рендерился корректный маркированный список с висячим отступом, а не плоский глиф `•`.

Правила: конвертируй **все** упоминания (Общая информация / Связанные требования / Якоря истины / Дополнительные материалы / текст). Только существующие страницы (проверены в Этапе 1.5). Если полная конвертация тела в storage/wiki рискованна — как минимум оформи макросами ключевые ссылки: Эпик в «Общей информации», «Якоря истины», «Дополнительные материалы», «Связанные требования»; остальное — валидными markdown-ссылками на существующие страницы. В сухом прогоне покажи, каким форматом и макросами публикуешь.

### ТАКТ 2. ЗАПИСЬ (только после явного «ок» PO)

Выполняй **последовательно**, захватывая ID каждого шага.

#### Шаг 1: Создать JIRA Эпик
- `jira_create_issue(project_key=<project>, summary=..., issue_type='Epic', description=..., labels=[...])`.
- Захвати `epicKey` (напр. `PROJ-102`).
- Если `issue_type='Epic'` отвергнут → СТОП, спроси PO точное имя типа.

#### Шаг 2: Дочерняя страница «краткое описание»
- `confluence_create_page(space_key=<space страницы {bft_parent_page_id}>, title=..., content=..., parent_id='{bft_parent_page_id}', content_format=<storage|wiki|markdown>)`.
- Jira/Confluence-упоминания → макросами (см. «Конвертация ссылок в макросы»). `epicKey` (из шага 1) подставь **Jira-макросом**, не голой ссылкой.
- Захвати `pageId_краткое`.
- Если parent `{bft_parent_page_id}` недоступен/нет прав → СТОП, доложи.

#### Шаг 3: Страница БФТ команды API-слой
- Режим **UPDATE**: `confluence_update_page(page_id=<pageId из frontmatter>, title=..., content=<полный документ>, content_format=<storage|wiki|markdown>)`. Режим **CREATE**: `confluence_create_page(space_key=<bft_space>, title=..., content=<полный документ>, parent_id=<bft_parent_id>, content_format=...)`, затем записать полученный `pageId` и URL обратно во frontmatter документа (`pageId`, `source`).
- Jira/Confluence-упоминания → макросами (см. «Конвертация ссылок в макросы»); `epicKey` (из шага 1) — Jira-макросом. Ссылки только на существующие страницы.
- **PlantUML → макрос «PlantUML» (ЗМ-015).** Блок ` ```plantuml … ``` ` оборачивай в макрос PlantUML, чтобы диаграмма рендерилась визуально, а не как код:
  - storage: `<ac:structured-macro ac:name="plantuml"><ac:plain-text-body><![CDATA[@startuml … @enduml]]></ac:plain-text-body></ac:structured-macro>`
  - wiki: `{plantuml}@startuml … @enduml{plantuml}`
  - Плагин «PlantUML» должен быть установлен в Confluence; если нет → `[УТОЧНИТЬ: плагин PlantUML не установлен]`, оставить блок кодом.
- **Спойлер «Подробный контекст»** в «Бизнес описании» → макрос Expand (storage: `<ac:structured-macro ac:name="expand">`; wiki: `{expand}`), сохраняя свёрнутость.
- Захвати `pageId_БФТ`.

#### Шаг 4: Связать документы с JIRA Эпиком
- `jira_create_remote_issue_link(issue_key=<epicKey>, url=<Confluence URL страницы 2>, title='Краткое описание запроса (<epic_code>)')`.
- `jira_create_remote_issue_link(issue_key=<epicKey>, url=<Confluence URL страницы 3>, title='БФТ <epic_code> (полный)')`.
- Опционально: добавить комментарий на Эпик со ссылками на обе страницы (`jira_add_comment`).

#### Этап 5: Манифест отгрузки + отчёт
- Сохрани `.bft/documentation/<epic_code>/artefacts/delivery.md`:
  ```
  # Отгрузка БФТ <epic_code>
  - Дата: ...
  - JIRA Эпик: <epicKey> — <URL>
  - Краткое описание (Confluence): pageId <id> — <URL>  (parent {bft_parent_page_id})
  - Полный БФТ (Confluence): pageId <id> — <URL>  (space <bft_space>, parent <bft_parent_id>)
  - Связи: epicKey ↔ обе страницы
  ```
- Финальный вывод:
  ```
  ✅ БФТ <epic_code> отгружен.
  Эпик: <epicKey> — <URL>
  Краткое описание: <URL>
  Полный БФТ: <URL>
  Связи проставлены. Манифест: .bft/documentation/<epic_code>/artefacts/delivery.md
  ```

---

## Запреты

1. **Не публикуй без явного «ок» PO** — сухой прогон обязателен, запись только во 2-м такте.
2. **Не публикуй при 🔴 в validation.md** — сначала `/bft-draft` + `/bft-validate`.
3. **Не выдумывай факты** в описаниях — только из черновика БФТ / problem / concept. Незакрытое → `[УТОЧНИТЬ]`.
4. **Не хардкодь `epicKey` / pageId** — они неизвестны до выполнения шагов 1-3.
5. **Не выполняй шаги параллельно** — шаг 4 зависит от ID шагов 1-3.
6. **Не эмулируй успех** при недоступности MCP (VPN) — честно `[УТОЧНИТЬ]`.
7. **Не подставляй секреты/токены** в описания; `.mcp.json` вне git.
8. **Не публикуй битые/выдуманные ссылки** (ЗМ-009) — только существующие страницы, подтверждённые в Этапе 1.5; Jira/Confluence — макросами для превью, не голым текстом.
9. **Не создавай дубль страницы БФТ.** Есть `pageId` во frontmatter — обновляй её. Вторая страница того же БФТ — ошибка отгрузки.
