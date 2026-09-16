# poh-bft-writer в корпоративном LibreChat

Как поднять полный контур БФТ (`fast → recon → custdev → deep → deliver`) в
корпоративной инсталляции LibreChat — по шагам, с честным списком того, что
переносится дословно, что требует адаптации и что не переносится вовсе.

Переписывать навыки не нужно. С **v0.8.6-rc1** LibreChat умеет Agent Skills на тех же
`SKILL.md` с frontmatter `name` + `description`, что кладёт `install.sh`, — семь
бандлов из `skills/` грузятся как есть. Адаптация нужна не контенту, а окружению:
файловой системе, внешним источникам, пину моделей и фоновым форкам.

> Гайд для администратора инстанса. Если прав на `librechat.yaml` нет, а нужно просто
> начать работать — [`librechat-user-setup.md`](librechat-user-setup.md): установка
> мышкой, за 10 минут, без единой строчки конфига.

## Что нужно заранее

| Что | Зачем | Проверка |
|---|---|---|
| LibreChat ≥ v0.8.6-rc1 | Agent Skills и субагенты появились в этой версии | «About» в интерфейсе |
| Code Interpreter (stateful) | линтеры и сборка HTML-страниц — это `python3`-скрипты навыка | `LIBRECHAT_CODE_BASEURL_STATEFUL` задан |
| MCP-сервер файловой системы | постоянный воркспейс: `.bft/documentation`, `.bft/index`, `bft-config.md` | шаг 4 |
| MCP-сервер Atlassian | JIRA и Confluence для `/bft-recon`, `/bft-deep`, `/bft-deliver` | шаг 5 |
| Две модели: лёгкая и сильная | `fast` рассчитан на Haiku, `deep` — на старшую модель | шаг 7 |
| `ffmpeg` + whisper.cpp на машине PO | распознавание записи встречи: в песочнице его не будет | `brew install ffmpeg whisper-cpp` |

## Карта соответствий

| В Claude Code / харнессе | В LibreChat |
|---|---|
| `.claude/skills/<навык>/SKILL.md` | Agent Skill (загрузка `.zip`, шаг 2) |
| `/bft-fast`, `/bft-deep`, … (`commands/*.md`) | агент стадии + `$bft-fast` в композере (+ промт-команда, шаг 8) |
| `<skills_path>` (автодетект `.claude/skills`) | `/mnt/data/skills` — монтирование Code Interpreter (шаг 3) |
| Воркспейс с `.bft/` | каталог MCP-сервера файловой системы (шаг 4) |
| `.mcp.json` | `mcpServers` в `librechat.yaml` (шаг 5) |
| `model: haiku` во фронтматтере команды | отдельный агент/`modelSpec` на стадию (шаг 7) |
| Фоновый форк субагента (`recon`/`custdev`/`deep`) | Subagents + `run_in_background` (шаг 9) |
| `plugin/` — раздел «Управление требованиями», доска стадий | эквивалента нет, см. «Что останется недоступным» |

## 1. Включить возможности инстанса

`librechat.yaml`, минимальный набор для полного контура:

```yaml
endpoints:
  agents:
    capabilities:
      - 'skills'               # Agent Skills — сами навыки
      - 'execute_code'         # python3-линтеры и сборка HTML
      - 'stateful_code_sessions'  # песочница живёт дольше одного вызова
      - 'subagents'            # форки recon/custdev/deep
      - 'run_in_background'    # форк не блокирует ответ PO
      - 'tools'                # MCP-инструменты JIRA/Confluence/файлов
      - 'actions'
      - 'file_search'          # вложения PO как источник для fast
      - 'context'
      - 'artifacts'
    maxSubagents: 10
    recursionLimit: 50         # deep — длинный контур: 11 разделов и десятки вызовов
```

> **Грабля.** `stateful_code_sessions`, `subagents`, `run_in_background` — opt-in:
> не перечислив их явно, вы получите агента, который умеет запускать код, но теряет
> файлы между вызовами и не умеет форкать разведку.

Дефолтный `recursionLimit: 25` для `/bft-deep` мал: аудит поднимает трекер, вики, git и
индекс, и упирается в лимит на середине документа.

## 2. Импорт навыков

Собрать по архиву на навык — `SKILL.md` должен лежать в корне архива или на один
уровень вглубь:

```sh
git clone https://github.com/po-helper-org/poh-bft-writer.git
cd poh-bft-writer/skills
for s in */; do (zip -qr "../${s%/}.zip" "${s%/}"); done
```

Получается семь архивов 4 КБ – 205 КБ (лимиты — 50 МБ, 500 файлов, 10 МБ на файл —
не близко). Дальше — любой из трёх путей:

**а) На себя, через UI.** Боковая панель → **Skills** → **+** → **Upload a skill** →
`.zip`. Повторить для нужных навыков.

**б) На всю инсталляцию, read-only.** Скопировать **содержимое** репозиторного
`skills/` — то есть сами каталоги навыков, каждый со своим `SKILL.md`, — в каталог
развёртывания LibreChat и указать на него в `.env`:

```sh
# по умолчанию — ./skill относительно корня проекта LibreChat
DEPLOYMENT_SKILLS_DIR=./skill
```

```
LibreChat/
  skill/                 ← это значение DEPLOYMENT_SKILLS_DIR
    bft-fast/SKILL.md
    bft-writer/SKILL.md
    …
```

Имя каталога любое (`skill` — умолчание LibreChat, `config/skills` и абсолютный путь
тоже принимаются), важно лишь, чтобы переменная указывала именно на тот каталог, внутри
которого лежат папки навыков. Такие навыки не правятся из UI — обновляются
перевыкладкой. Для корпоративной установки это правильный путь: у всех PO одна версия
методологии.

**в) Автосинк из GitHub.** Репозиторий остаётся источником правды:

```yaml
skillSync:
  github:
    enabled: true
    intervalMinutes: 60
    runOnStartup: true
    sources:
      - id: poh-bft-writer
        owner: po-helper-org
        repo: poh-bft-writer
        paths: ['skills']
        skillDiscoveryDepth: 2
        token: '${GITHUB_SKILLS_TOKEN}'
```

Репозиторий приватный — токен обязателен. Если корпоративная сеть до github.com не
ходит, зеркальте репозиторий во внутренний GitHub/GitLab и синкайте оттуда (или
оставайтесь на способе «б»).

> **Грабля.** Повторная загрузка навыка с тем же именем **падает**, а не
> перезаписывает. Обновление через UI — сначала удалить старый; через «б»/«в» —
> перевыкладка и синк делают это за вас.

**Проверка.** В композере набрать `$` — в списке должны быть `bft-fast`, `bft-writer`,
`bft-recon`, `bft-custdev`, `bft-deep-swarm`, `bft-indexer`, `bft-wireframing`.

## 3. Code Interpreter: скрипты навыка

Файлы бандла монтируются в песочницу по пути `/mnt/data/skills/{имя навыка}/…` —
относительная раскладка сохраняется, поэтому вызовы навыка вида
`python3 <skills_path>/bft-writer/scripts/bft-lint.py <файл>` работают, если
`<skills_path>` = `/mnt/data/skills` (шаг 6).

Все `python3`-скрипты навыка написаны на голой стандартной библиотеке (`argparse`,
`pathlib`, `re`, `json`, `html`…) — `pip install` в песочнице не нужен ни для одного
из них: `bft-lint.py`, `bft-style-lint.py`, `bft-ground-lint.py`, `bft-paths-lint.py`,
`bft-custdev-lint.py`, `bft-html-export.py`, `bft-custdev-export.py`,
`bft-deliver-check.py`, `bft-confluence-macros.py`.

> **Грабля — `bft-writer` подключать обязательно.** В `bft-fast`, `bft-custdev` и
> `bft-recon` зашиты вызовы скриптов из бандла `bft-writer`. Монтируются только файлы
> **активных** навыков, поэтому `bft-writer` должен быть включён у агента вместе с
> любым другим навыком семейства — иначе линтер и сборка страницы падают на
> «файл не найден».

**Проверка** (в чате агента, при включённом Code Interpreter):

```
Выполни: python3 /mnt/data/skills/bft-writer/scripts/bft-lint.py --help
```

## 4. Постоянный воркспейс

`/mnt/data` — не хранилище: stateful-песочница может быть сброшена в любой момент, и
документ эпика вместе с ней. Для полного контура нужен MCP-сервер файловой системы,
смонтированный на сетевой каталог отдела:

```yaml
mcpServers:
  bft-workspace:
    type: streamable-http
    url: https://mcp-fs.corp.local/mcp
    headers:
      X-User-ID: '{{LIBRECHAT_USER_ID}}'
      Authorization: 'Bearer ${BFT_FS_TOKEN}'
    timeout: 30000
    chatMenu: false
```

Что в этом каталоге лежит:

| Путь | Что это |
|---|---|
| `bft-config.md` | конфиг (шаг 6); навыки читают его из корня воркспейса |
| `.bft/documentation/<epic_slug>/` | документы эпика: `-fast.md`, `.md`, `-custdev.md`, `.html`, `context_map.md`, `personas.csv`, `requirements.csv` |
| `.bft/index/` | индекс воркспейса, который строит `/bft-index` |

Схема работы: навык пишет артефакт через MCP файловой системы, а запускает линтер в
Code Interpreter. Если ваш MCP-сервер не отдаёт файлы прямо в песочницу, порядок
такой — собрать документ, сохранить в воркспейс, для прогона линтера положить копию в
`/mnt/data`, результат линта применить к файлу в воркспейсе. Дешевле поднять
MCP-сервер над тем же томом, что примонтирован к Code Interpreter: тогда путь один.

Без шага 4 контур тоже работает, но вырождается в «одна беседа — один эпик»:
`/bft-deep` не найдёт документ, собранный `/bft-fast` вчера, а `/bft-index` строить
нечего и не по чему.

## 5. JIRA и Confluence

Навыки зовут инструменты Atlassian MCP по именам:
`jira_get_issue`, `jira_search`, `jira_add_comment`, `jira_create_issue`,
`jira_create_remote_issue_link`, `jira_remove_remote_issue_link`,
`confluence_get_page`, `confluence_search`, `confluence_create_page`,
`confluence_update_page`, `confluence_upload_attachment`. Сервер должен отдавать
инструменты ровно с этими именами — иначе правьте вызовы в навыках.

```yaml
mcpServers:
  atlassian:
    type: streamable-http
    url: https://mcp-atlassian.corp.local/mcp
    initTimeout: 30000
    timeout: 60000
    serverInstructions: true
    customUserVars:
      JIRA_PERSONAL_TOKEN:
        title: 'Токен JIRA'
        description: 'Personal Access Token — создать в профиле JIRA'
      CONFLUENCE_PERSONAL_TOKEN:
        title: 'Токен Confluence'
        description: 'Personal Access Token — создать в профиле Confluence'
```

Для корпоративной установки `customUserVars` (или OAuth с PKCE, если Atlassian
поднят на нём) — не деталь, а требование: `/bft-deliver` публикует страницу и
комментирует задачу **от имени PO**. Сервисный технический пользователь на всю
компанию ломает аудит («кто согласовал») и обходит права на пространства.

> **Грабля — `bft-env-lint.py` здесь неприменим.** Скрипт проверяет форму
> `.mcp.json` (есть ли сервер трекера и вики, не лежит ли секрет значением), которого
> в LibreChat нет. Стадия 0а `/bft-deep` держится на второй проверке, которая важнее:
> живой read-only вызов (`jira_get_issue` по ключу эпика, `confluence_get_page` по
> `pageId`) с тремя честными исходами — доступен / не настроен / не отвечает.
> Пропускайте `bft-env-lint.py` и не считайте его отсутствие поломкой сетапа.

## 6. `bft-config.md` под LibreChat

Автодетект `skills_path` ищет `.claude/skills`, `.agents/skills`, `.clinerules/skills`,
`skills` — в LibreChat ни одного из них нет, поэтому пути задаются явно. Положить в
корень воркспейса (шаг 4):

```md
# bft-config

## tracker_projects
PO, LKB2B

## wiki_space
BFT

## bft_parent_page_id
123456789

## skills_path
/mnt/data/skills

## docs_path
.bft/documentation

## index_path
.bft/index

## plantuml_render
macro

## transcribe_language
ru
```

`plantuml_render: macro` — не вкус, а следствие шага 3: пре-рендер PNG требует
`plantuml` CLI или docker, а песочница Code Interpreter без сети и без этих бинарей.
Макрос требует плагина «PlantUML» в вашем Confluence; нет плагина — диаграммы уедут
в документ как код с пометкой `[УТОЧНИТЬ]`.

## 7. Агенты по стадиям

`model: haiku` из фронтматтера команд в LibreChat не переносится — модель задаёт
агент. Поэтому стадии разводятся по агентам, и это заодно чинит экономику: fast — это
раскладка сказанного по формам, ему сильная модель не нужна.

| Агент | Модель | Навыки | MCP | Что делает |
|---|---|---|---|---|
| **БФТ · Fast** | Haiku | `bft-fast`, `bft-writer` | только файловый | письмо, два csv, документ-шапка, страница ревью |
| **БФТ · Deep** | старшая | `bft-deep-swarm`, `bft-writer`, `bft-recon`, `bft-custdev`, `bft-wireframing`, `bft-indexer` | файловый + `atlassian` | аудит, канон из 11 разделов, публикация |

Настройка в Agent Builder: **Enable skills** → добавить перечисленные (режим
«Selected», не «Use all skills» — так навык стадии не подхватится в чужой беседе);
**Code Interpreter** — включить обоим; MCP — из библиотеки инструментов, у Fast
`atlassian` **не подключать**: `/bft-fast` наружу не ходит по построению, и лишний
инструмент этот периметр размывает.

> **Грабля — длинные `description`.** У навыков описания 329–601 символ при
> рекомендованных ≤250: каталог для модели раздувается, автоподбор навыка становится
> менее точным. Если полагаетесь на model-invoked режим, подрежьте `description` в
> своей копии, оставив триггеры («написать БФТ», «/bft-fast», «запись встречи»).
> В режиме «Selected» + `$`-вызов это не важно.

## 8. Команды `/bft-*`

Слэш-команд из `commands/*.md` в LibreChat нет. Два способа вызвать стадию:

1. **`$`-вызов** — набрать `$bft-fast` в композере и приложить источник. Тело навыка
   примируется целиком; за ход можно поднять до 10 навыков вручную.
2. **Промт-библиотека** — завести промт с командой на каждую стадию, тело взять из
   `commands/<команда>.md` (раздел «Использование» + параметры), вызов через `/`.
   Так у PO сохраняется привычная запись `/bft-fast <источник> <epic_slug>`, а промт
   разворачивается в инструкцию, которая уже зовёт `$bft-fast`.

Для корпоративной установки — второй: команды становятся общими для отдела через
права промт-библиотеки, а параметры (`--no-deep`, `--no-recon`, `--no-custdev`,
`--no-html`) остаются в тексте промта на виду.

## 9. Фоновые форки

`/bft-fast` штатно форкает три фоновых прохода: разведку (`bft-recon`), подготовку
интервью (`bft-custdev`) и глубину (`bft-deep-swarm`). В LibreChat это субагенты:

1. В Agent Builder агента **БФТ · Fast** → Advanced Settings → включить **Subagents**,
   в `agent_ids` добавить агентов-исполнителей (обычно **БФТ · Deep** и отдельного
   «БФТ · Recon» с одним навыком `bft-recon` и `atlassian`).
2. Включить **run_in_background** — иначе PO ждёт обхода JIRA и Confluence вместо
   того, чтобы читать письмо, ради чего форк и придуман.
3. Ход субагентов виден в панели активности: их можно остановить, дозадать вопрос
   или отменить.

Проще начать без форков: собрать fast, прочитать письмо, затем вручную `$bft-recon` и
`$bft-deep-swarm` в той же беседе. Форки — оптимизация ожидания, а не условие
корректности; в тексте навыков они и описаны как отключаемые (`--no-recon`,
`--no-custdev`, `--no-deep`).

## 10. Приёмка контура

Прогон на эталоне, который лежит в самом навыке — ничего придумывать не нужно:

1. `$bft-fast` + `/mnt/data/skills/bft-fast/examples/golden_summary.md` → в чате
   письмо (Цель, How to demo, Открытые вопросы, Границы), в воркспейсе `-fast.md`,
   `personas.csv`, `requirements.csv` и `-fast.html`.
2. Линтер прошёл: `python3 /mnt/data/skills/bft-writer/scripts/bft-lint.py <файл>`
   вернул 0.
3. `$bft-recon` → `context_map.md` со ссылками на реальные страницы Confluence и
   задачи JIRA (не «по общим знаниям»).
4. `$bft-custdev` → скрипт интервью и страница встречи.
5. `$bft-deep-swarm` → `<epic_slug>.md` с каноном из 11 разделов; стадия 0а честно
   пометила недоступные источники `UNAVAILABLE`.
6. `/bft-deliver` → страница в Confluence создана **от имени PO**, ссылка в задаче.

Сломалось на 1–2 — смотрите шаги 2–3 (монтирование и `bft-writer` рядом); на 3–6 —
шаг 5 (MCP и права).

## Что останется недоступным

Говорим честно, чтобы не искали ошибку там, где её нет.

**Распознавание записи встречи.** `bft-transcribe.py` требует `ffmpeg` и
`whisper-cli`; песочница Code Interpreter без сети и без этих бинарей, а корпоративный
периметр всё равно запрещает отправлять запись встречи наружу. Путь: PO распознаёт
запись **у себя** (`/bft-transcribe <запись>` в Claude Code либо `whisper-cli`
руками), а в LibreChat приносит готовый транскрипт — для навыка это обычный
источник-транскрипт.

**Пре-рендер PlantUML в PNG.** См. шаг 6: только `macro`, и только с плагином в
Confluence.

**Раздел «Управление требованиями»** — очередь БФТ по стадиям, доска семи стадий,
кнопка «Добавить в OKR», чат на детальной странице. Это плагин `plugin/` для
DeepSeek Harness: он написан под API плагинов харнесса и в LibreChat не
устанавливается ни в каком виде. Обе половины независимы (`plugin/test-dual-mode.sh`
это проверяет), поэтому навыки в LibreChat работают полноценно и без него — но доски
стадий там не будет. Нужна доска — держите харнесс рядом, он читает те же файлы
воркспейса.

**`bft-env-lint.py`** — проверяет форму `.mcp.json`, которого в LibreChat нет (шаг 5).

## Обновление

Навыки в LibreChat живут своей копией и устаревают отдельно от репозитория:

- способ «а» (UI) — удалить навык и загрузить свежий `.zip`; переименования не нужно,
  но повторная загрузка одноимённого без удаления падает;
- способ «б» — перевыложить `DEPLOYMENT_SKILLS_DIR` и перезапустить;
- способ «в» — ничего не делать: `skillSync` подтянет `main` на следующем интервале.

`update.sh` из репозитория к LibreChat неприменим: он обновляет чекаут, сборку плагина
и навыки воркспейса харнесса.
