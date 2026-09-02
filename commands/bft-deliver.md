---
description: 'Отгрузка БФТ — публикация в JIRA+Confluence, связывание артефактов (роль: Deliverer). Сухой прогон → ок PO → запись'
---

## Использование

```
/bft-deliver <epic_code> [bft_space] [bft_parent_id] [project]
```

**Параметры:**
- `<epic_code>` — короткий код БФТ (напр. `EPIC-10`, `EPIC-FAQ`). По нему находится документ БФТ в папке эпика: `<docs_path>/<epic_code>/<epic_code>.md`, где `docs_path` — ключ из `bft-config.md` (дефолт `.bft/documentation`). Для документа v2 `epic_code` — **то же значение, что `epic_slug`** во frontmatter. Доставляется финальный документ `<docs_path>/<epic_slug>/<epic_slug>.md` — его владелец `/bft-deep`; `/bft-fast` пишет отдельный `<epic_slug>-fast.md`, который deep читает как seed и не перезаписывает (`skills/bft-fast/resources/document_assembly.md` §«Путь файла»). Финального файла нет (deep не запускался) → доставлять нечего.
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

**Роль: Deliverer.** Финальная стадия pipeline: v2 — после `/bft-deep`; v1 — после `/bft-validate` (итог 🟢/🟡). Берёт **валидный** документ БФТ и публикует 4 артефакта: JIRA Эпик + 2 страницы Confluence + связи между ними.

> Аналог sa-helper: нет прямого; это финал публикации после `/validate-doc`.

**Анти-правило (приоритет):** JIRA и Confluence — **только чтение до явного «ок» PO**. Поэтому команда работает в 2 такта:
1. **Сухой прогон** — собирает preview всех 4 артефактов БЕЗ записи, выводит STOP.
2. После «ок» PO — **выполняет 4 шага подряд**, захватывая ID каждого артефакта для связывания.

**Принципы:**
- Источник содержимого — **только валидный документ БФТ** из папки эпика. Не выдумывай факты заново.
- **Повторный прогон безопасен (идемпотентность).** Повтор `/bft-deliver` — штатная ситуация (упал шаг 4, поправили ссылку, отгружаем заново). Перед записью каждый из 4 артефактов резолвит режим по сохранённым id: Эпик — `jira` во frontmatter документа; дочерняя страница — `summary_pageId` в манифесте `<docs_path>/<epic_code>/artefacts/delivery.md`; страница БФТ — `pageId` во frontmatter; связи — по уже существующим remote links Эпика. Найден id → переиспользовать/обновить, не создавать.
- `{bft_parent_page_id}` — родительская страница «краткого сутевого описания запроса» (из `bft-config.md`, опционально; не задано → `[УТОЧНИТЬ у PO]`).
- Каждый шаг захватывает ID (epicKey, pageId) → передаёт на шаг связывания. **Последовательно, не параллельно.**
- VPN/Confluence/JIRA недоступны → честно `[УТОЧНИТЬ: MCP недоступен]`, не эмулировать успех.
- **Ссылки Jira/Confluence → макросы Confluence (ЗМ-009).** На публикуемых страницах каждое упоминание Jira/Confluence отдаётся макросом для быстрого доступа и превью, а не голой markdown-ссылкой (см. «Конвертация ссылок в макросы» ниже). Ссылка ведёт только на **существующую** страницу; несуществующее (эпик ещё не создан) не превращать в битую ссылку.

---

## Инструкция для ЛLM

### ТАКТ 1. СУХОЙ ПРОГОН (без записи)

#### Этап 1: Загрузка входов
1. **Резолв конфига.** Из `bft-config.md`: `docs_path` (дефолт `.bft/documentation`), `wiki_space`, `bft_parent_page_id`, `tracker_projects`, `plantuml_render`. Папка эпика — `<docs_path>/<epic_code>/`, артефакты — `<docs_path>/<epic_code>/artefacts/`. Путь нигде не хардкодить: `docs_path` резолвится один раз здесь и подставляется во все дальнейшие пути.
2. Найди документ БФТ: `<docs_path>/<epic_code>/<epic_code>.md`. Нет → СТОП:
   ```
   🔴 Документ БФТ <epic_code> не найден: <docs_path>/<epic_code>/<epic_code>.md.
   → v2: /bft-fast <источник> <epic_code>, затем /bft-deep <epic_code>.
   → v1: /bft-draft <epic_code>, затем /bft-validate <epic_code>.
   ```
3. **Прочитай frontmatter документа:** `source`, `space`, `pageId`, `version`, `synced`, `jira`, `status`, `epic_slug`, `stage`, `pin_commit`. Значения `jira`, `pageId`, `stage` задают режимы артефактов (Этап 2). `epic_slug` должен совпадать с `<epic_code>`; расходится → отгружай по `epic_slug` из документа и скажи об этом в STOP-отчёте.
4. **Прочитай манифест прошлой отгрузки** `<docs_path>/<epic_code>/artefacts/delivery.md`, если он есть. Он — durable-хранилище id **дочерней страницы**: ключи `jira`, `summary_pageId`, `bft_pageId` в его frontmatter (формат — Этап 5). Отдельный frontmatter-ключ в документе БФТ под дочернюю страницу не вводится: контракт документа — ровно 10 ключей (`skills/bft-fast/resources/document_assembly.md` §Frontmatter). Манифеста нет → id дочерней страницы неизвестен, режим CREATE.
5. **Гейт валидации.**
   - Есть `artefacts/validation.md` и в нём 🔴 в Hard Gates → СТОП, отгрузка запрещена:
     ```
     🔴 БФТ <epic_code> не прошёл валидацию (есть 🔴 в Hard Gates).
     → v2: /bft-deep <epic_code> (доработать), v1: /bft-draft <epic_code>, затем /bft-validate.
     ```
   - **Нет `artefacts/validation.md` ИЛИ `stage: fast` во frontmatter** → это документ-шапка после `/bft-fast`, а не валидированный БФТ (в v2 `validation.md` появляется только после `/bft-deep`). Не СТОП-запрет, но и не штатный ход: вынеси предупреждение в STOP-отчёт (Этап 3) и потребуй **отдельного явного подтверждения PO** — сверх общего «ок» — строкой «отгружаю шапку без глубокой проработки». Нет обоих подтверждений → не публиковать. Нормальный следующий шаг предлагай первым: `/bft-deep <epic_code>`.
6. Прочитай `problem.md` + `concept.md` (если есть) — для краткой выжимки.
7. Зафиксируй параметры: `epic_code`, `bft_space` (дефолт = `wiki_space` из `bft-config.md`), `bft_parent_id`, `project` (дефолт = первый проект из `tracker_projects` в `bft-config.md`).
8. **Проверка ссылок (ЗМ-009).** Собери все упоминания Jira/Confluence из документа. Где MCP доступен — подтверди существование каждой: Jira-ключ → `jira_get_issue`; Confluence pageId → `confluence_get_page`. Несуществующее/невалидное **не публиковать ссылкой** — понизь до `[УТОЧНИТЬ]` или пометки без URL и вынеси в STOP-отчёт. Ссылки только на существующие страницы.

#### Этап 2: Сборка preview 4 артефактов

**Превью 1 — JIRA Эпик** (project=`<project>`):
- `summary`: название БФТ (из H1 черновика, без префикса `[БФТ]`).
- `issue_type`: `Epic`. Если тип в проекте называется иначе → пометь `[УТОЧНИТЬ: issue_type Epic в <project>]`.
- `description`: из блока `Цель` шапки + ключевые БТ + ссылка на полный БФТ (placeholder, ссылку подставишь на шаге связывания). Markdown.
- `labels`: `bft`, `epic_code`.
- Доп. поля: priority/assignee только если явно есть в черновике, иначе не выдумывать.

**Превью 2 — Дочерняя страница «краткое сутевое описание»** (parent=`{bft_parent_page_id}`):
- `title`: `<epic_code>: <Название БФТ> — краткое описание запроса`.
- `body` — **выжимка** (не копия всего БФТ):
  - Суть запроса: 2-3 предложения (из блока `Цель` шапки).
  - As-Is → Gap (из problem.md, 2-4 строки).
  - Образ результата (из концепта/БТ, 1-2 пункта).
  - Ключевые ФТ (3-5 шт, верхнеуровнево).
  - Плейсхолдеры: `[Эпик: подставится]`, `[Полный БФТ: подставится]`.
- `content_format`: markdown.

**Превью 3 — Страница БФТ команды API-слой** (space=`<bft_space>`, parent=`<bft_parent_id>`):
- **Сначала прочитать `pageId`/`source` из frontmatter документа.** Есть `pageId` (не `pending`) → режим **UPDATE**: страница уже создана `/bft-fast` и обогащена `/bft-deep`, публикуем финальную версию в неё, **новую страницу не создаём**. Нет `pageId` или `pending` → режим **CREATE** (как раньше). Режим показать в сухом прогоне явной строкой: `режим: UPDATE pageId=<id>` или `режим: CREATE (страница ещё не создана)`.
- `title`: `[БФТ] <epic_code>: <Название>` (как H1 черновика).
- `body`: **полное содержимое** файла `<docs_path>/<epic_code>/<epic_code>.md` (frontmatter убери, остальное 1:1 — PlantUML-блоки сохраняй как есть). В документе v2 шапка, строка-граница `BFT-HEAD-END` и блок открытого поля публикуются вместе с каноном — это один документ.
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

▸ ДИАГРАММЫ (ЗМ-015) — режим: <image|macro|auto>; найдено <N> блоков ```plantuml
   рендерер: <plantuml CLI | docker | server | НЕТ → [УТОЧНИТЬ]>; при image страница публикуется в storage-формате, диаграммы → PNG-вложения

── СТОП ──
PO: подтверди «ок» (или поправь параметры) → выполню все 4 шага с записью.
Без «ок» — ничего не публикую.
```

---

### Конвертация ссылок в макросы Confluence (ЗМ-009)

Публикуемые страницы (Шаги 2–3) отдают Jira/Confluence-упоминания **макросами**, чтобы PO из документа сразу видел превью и статус.

**Инструмент:** `python3 skills/bft-writer/scripts/bft-confluence-macros.py <epic>.md --confluence-map <map.json> --format storage|wiki -o <converted>.txt`. `<map.json>` — `{"<pageId>": {"title": "...", "space": "SPACE"}}`, собери сам через `confluence_get_page` для каждого pageId из Этапа 1.5 (скрипт Confluence не читает, только подставляет уже известные title/space). Jira-ссылкам map не нужен — ключ уже в URL. Прогони на всём теле документа перед публикацией — это и есть шаг «конвертируй все упоминания» ниже, а не ручная правка построчно.

Если скрипт недоступен/нет времени на map — делай вручную по тем же правилам:
- **`storage`** — макросы как XHTML (надёжно для Jira-макроса).
  - Jira: `[JIRA GDSLV-1610](…)` → `<ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">GDSLV-1610</ac:parameter></ac:structured-macro>`
  - Confluence-страница: → `<ac:link><ri:page ri:content-title="<Заголовок>"/></ac:link>` (или макрос `include`/`excerpt-include` для превью содержимого).
- **`wiki`** — легче совмещать макросы с таблицами/текстом:
  - Jira: `{jira:key=GDSLV-1610}` · Confluence: `[<Заголовок страницы>]` или `{include:<Space>:<Заголовок>}`.

HTML-разметки в ячейках таблиц нет и при публикации не появляется (ЗМ-021): ячейка — одна короткая формулировка. Списком её не верстать ни тегами `<ul><li>`, ни глифом `•` — если содержимое просится в список, формулировка слишком длинная.

Правила: конвертируй **все** упоминания (блоки шапки «Общая информация» и «Документация» / Связанные требования / Якоря истины / текст). Только существующие страницы (проверены в Этапе 1.5). Если полная конвертация тела в storage/wiki рискованна — как минимум оформи макросами ключевые ссылки: Эпик в блоке «Общая информация», «Якоря истины», блок «Документация», «Связанные требования»; остальное — валидными markdown-ссылками на существующие страницы. В сухом прогоне покажи, каким форматом и макросами публикуешь.

**Пре-флайт.** Перед публикацией (в конце Этапа 2 сухого прогона) прогони `python3 skills/bft-writer/scripts/bft-deliver-check.py <epic>.md` — он считает, сколько голых Jira/Confluence-ссылок и сырых ` ```plantuml ` блоков всё ещё не сконвертировано, и печатает список. Ненулевой результат покажи в STOP-отчёте (Этап 3, блок «ССЫЛКИ»/«ДИАГРАММЫ») — не публикуй, зная, что конвертация не выполнена, если PO явно не попросил ускоренный прогон без неё.

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
- Режим **UPDATE** (`pageId` во frontmatter документа есть и не `pending` — страницу создал `/bft-fast`, обогатил `/bft-deep`): `confluence_update_page(page_id=<pageId из frontmatter>, title=..., content=<полный документ>, content_format=<storage|wiki|markdown>)`. Новую страницу не создавать.
- Режим **CREATE** (`pageId` нет или `pending`): `confluence_create_page(space_key=<bft_space>, title=..., content=<полный документ>, parent_id=<bft_parent_id>, content_format=<storage|wiki|markdown>)`, затем записать полученный `pageId` и URL обратно во frontmatter документа (`pageId`, `source`).
- **Если в БФТ есть блоки ` ```plantuml ` и режим `image`** — вызов (UPDATE или CREATE) выполняется по правилам ЗМ-015 п.2 ниже: `content_format=storage`, а на месте диаграмм в теле идут плейсхолдеры (картинки подставятся на п.4). Отдельного второго создания страницы нет; в режиме UPDATE вложения грузятся на ту же существующую страницу.
- Jira/Confluence-упоминания → макросами (см. «Конвертация ссылок в макросы»); `epicKey` (из шага 1) — Jira-макросом. Ссылки только на существующие страницы.
- **PlantUML → отрендеренная картинка-вложение (ЗМ-015).** Блок ` ```plantuml … ``` ` НЕ публикуется кодом и НЕ полагается на плагин. По умолчанию (`plantuml_render: image` из `bft-config.md`) диаграмма пре-рендерится в PNG и встраивается вложением — рендерится в любом Confluence/JIRA, без плагина. Порядок строгий: **вложение можно загрузить только на уже существующую страницу**, поэтому сначала создаём страницу, потом грузим PNG, потом подставляем картинку в тело.
  1. **Рендер.** `python3 skills/bft-writer/scripts/bft-render-plantuml.py <epic>.md --out-dir <tmp>/diagrams/` — находит все ` ```plantuml ` блоки, рендерит каждый в PNG (пробует `plantuml` CLI, затем `docker run plantuml/plantuml`, в этом порядке), печатает в stdout тело документа с плейсхолдерами `[[PLANTUML-<N>]]` на месте диаграмм и манифест `N → путь к PNG` в stderr; код возврата ненулевой, если хоть один блок не отрендерился.
     - Ни `plantuml`, ни `docker` не найдены (или конкретный рендер упал) → скрипт сам пишет `[УТОЧНИТЬ: нет рендерера PlantUML]` для этого блока в манифест — **не публиковать кодом молча**, вынести это в STOP-отчёт.
     - Ручной fallback (скрипт недоступен): вынь тело `@startuml … @enduml` в файл `diagram-<N>.puml` и `plantuml -tpng diagram-<N>.puml`, либо `docker run --rm -v "$PWD:/w" plantuml/plantuml -tpng /w/diagram-<N>.puml`, либо POST в PlantUML-server.
  2. **Создание страницы.** Тот же `confluence_create_page` из начала Шага 3, но `content_format=storage` (обязательно для `<ac:image>`) и на месте каждой диаграммы — плейсхолдер `[[PLANTUML-<N>]]`. Захвати `pageId`.
  3. **Загрузка вложений.** На полученный `pageId` загрузи каждый PNG: `confluence_upload_attachment(content_id=<pageId>, file_path="diagram-<N>.png")`. MCP-аплоад недоступен/сломан → fallback: прямой Confluence REST изнутри окружения. Токен брать из переменной окружения, наружу не выносить и в лог не печатать:

     ```
     curl -sS -X POST \
       -H "Authorization: Bearer $CONFLUENCE_TOKEN" \
       -H "X-Atlassian-Token: nocheck" \
       -F "file=@diagram-<N>.png" \
       "$CONFLUENCE_BASE/rest/api/content/<pageId>/child/attachment"
     ```

     - `X-Atlassian-Token: nocheck` **обязателен** — без него multipart-загрузка отдаётся 403.
     - `$CONFLUENCE_BASE`: Server/DC (напр. `https://confluence.mts.ru`) → путь `/rest/api/…` как выше. Confluence **Cloud** → база с суффиксом `/wiki`, т.е. `/wiki/rest/api/…`.
     - Ответ содержит `results[0].title` — это имя вложения для `ri:filename` на п.4.
  4. **Замена в теле.** `confluence_update_page`: замени каждый `[[PLANTUML-<N>]]` на `<ac:image ac:align="center"><ri:attachment ri:filename="<имя вложения из ответа п.3>"/></ac:image>`. Имя бери **из ответа загрузки** (REST — `results[0].title`; MCP — поле имени вложения), не подставляй `diagram-<N>.png` вслепую: Confluence может нормализовать имя файла, и тогда картинка не найдётся.
- **Опционально — макрос «PlantUML»** (только `plantuml_render: macro` И плагин подтверждён в целевом пространстве): storage `<ac:structured-macro ac:name="plantuml"><ac:plain-text-body><![CDATA[@startuml … @enduml]]></ac:plain-text-body></ac:structured-macro>`, wiki `{plantuml}@startuml … @enduml{plantuml}`. `plantuml_render: auto` — по умолчанию картинка (п.1–4); макрос только если плагин **подтверждён явно**: PO подтвердил в сухом прогоне (режим показан в STOP-отчёте) либо в `bft-config.md` у ключа `plantuml_render` прямо указано, что плагин установлен. Плагин не подтверждён — **не гадать и не проверять эвристикой**, публиковать картинкой. Голый блок кода как финал недопустим ни при каком режиме.
- **Спойлер «Подробный контекст»** в «Бизнес описании» → макрос Expand (storage: `<ac:structured-macro ac:name="expand">`; wiki: `{expand}`), сохраняя свёрнутость.
- Захвати `pageId_БФТ`.

#### Шаг 4: Связать документы с JIRA Эпиком
- `jira_create_remote_issue_link(issue_key=<epicKey>, url=<Confluence URL страницы 2>, title='Краткое описание запроса (<epic_code>)')`.
- `jira_create_remote_issue_link(issue_key=<epicKey>, url=<Confluence URL страницы 3>, title='БФТ <epic_code> (полный)')`.
- Опционально: добавить комментарий на Эпик со ссылками на обе страницы (`jira_add_comment`).

#### Этап 5: Манифест отгрузки + отчёт
- Сохрани `<docs_path>/<epic_code>/artefacts/delivery.md`:
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
  Связи проставлены. Манифест: <docs_path>/<epic_code>/artefacts/delivery.md
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
