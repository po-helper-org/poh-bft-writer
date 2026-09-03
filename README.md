# poh-bft-writer

Автономный генератор БФТ (бизнес-функциональных требований) для эпиков трекера в
корпоративном формате MTS. Переносимый навык: подключается в любой воркспейс, сам строит
контекст, генерирует БФТ уровня отлаженной методологии po-helper — без внешних зависимостей.

**Функция [манифеста](https://github.com/po-helper-org/.github/blob/main/profile/README.md):**
2 — границы и приёмка. Меряется готовностью требований и числом возвратов от
команд-исполнителей.

## Установка

**Через ИИ-помощника:** скажи «Установи bft-writer в этот репозиторий».

**Через терминал:**
```bash
curl -ksSL https://raw.githubusercontent.com/po-helper-org/poh-bft-writer/main/install.sh | bash
```
Скрипт спросит IDE-агента (Claude Code / Codex / Cline / DevX / Universal) и синкнет
команды и навыки в нужный корень. После установки запусти `/bft-index` — навык проведёт
первичную аналитику воркспейса и построит себе контекст.

## Для ИИ-помощника (bootstrap)
Если пользователь просит «Установи bft-writer»: (1) запусти `curl -ksSL <repo>/install.sh | bash`
или склонируй и запусти `install.sh`, выбрав IDE-агента пользователя; (2) после синка — сразу
запусти `/bft-index` для первичной аналитики воркспейса; (3) покажи MANIFEST-покрытие и предложи
`/bft-context-gen`.

## HowToDemo

1. «Установи bft-writer» или curl из README → навык в репозитории.
2. Команды `/bft-*` доступны.
3. `/bft-index` проводит первичную аналитику и строит контекст (`.bft/index/`).
4. Полный workflow: `/bft-context-gen → /bft-problem → /bft-concept → /bft-debate → /bft-draft → /bft-validate → /bft-deliver` (STOP-паузы, human-in-the-loop).
5. v2 автономка (единый растущий документ):
   `/bft-fast` — **стенографист**: наружу не ходит (ни JIRA, ни Confluence, ни индекс),
   фиксирует продиктованное PO в правильной форме. Письмо в чат + два csv-вложения +
   локальный документ-шапка `<epic_slug>-fast.md` (Цель = SMART-таблица, How to demo,
   Ограничения и договоренности, Документация, Критичные требования на цитатах,
   Общая информация) + открытое поле
   с промтом для доведения. Открытые вопросы уходят в чат, не в документ. Рассчитан на Haiku;
   `/bft-recon` — **разведчик**: пока вы читаете письмо, фоновый субагент обходит
   JIRA и Confluence **только на чтение** и кладёт рядом карту находок
   `context_map.md` — что по теме уже описано, с чем пересекается, что раньше
   отклонили, кто вёл тему. В письмо, csv и документ ничего не дописывает: находки
   приходят нотификацией со ссылками, решение за PO (`--no-recon` отключает);
   `/bft-deep` — **аудитор**: поднимает индекс `.bft/index/`, Confluence, JIRA, git и
   прошлые артефакты, сначала формирует уточняющие вопросы к PO по пяти срезам
   (пробел / противоречие / edge-кейс / граница / термин), затем пишет полный документ
   `<epic_slug>.md` с каноном из 11 разделов и обновляет страницу
   (форкается в фоне автоматически, `--no-deep` отключает, либо запускается вручную);
   `/bft-deliver` — JIRA-эпик, **одна** страница Confluence, связи; страницу обновляет, не дублирует (ЗМ-031).
   Форк отключён, упал или про задачу забыли — открой блок «Довести до полного БФТ» внизу
   документа, скопируй промт в Claude Code и продолжи с любой точки.
6. Результат соответствует практикам po-helper: 20 hard gates (17 — структура, 18 — anti-slop лексика, 19 — сверка с источником, 20 — карта контекста `/bft-recon`), стиль/голос, Lessons Learned, урезанный канон MTS (ЗМ-016), ранги якорей, CATWOE, adversarial-дебаты.

## Проверка шаблона (гейт 17)

Структуру документа проверяет скрипт, а не самоотчёт модели. `<skills_path>` — папка `skills/` установки:
`.claude/skills` (Claude Code), `.agents/skills` (Codex), `.clinerules/skills` (Cline/DevX) или `skills` при запуске
из клона репозитория; переопределяется ключом `skills_path` в `bft-config.md`.

```bash
python3 <skills_path>/bft-writer/scripts/bft-lint.py .bft/documentation/<epic_slug>/<epic_slug>.md
python3 <skills_path>/bft-writer/scripts/bft-style-lint.py .bft/documentation/<epic_slug>/<epic_slug>.md
python3 <skills_path>/bft-writer/scripts/bft-ground-lint.py .bft/documentation/<epic_slug>/<epic_slug>.md --source <входной Summary> --strict
```

Ненулевой код выхода — документ не по шаблону: потеряна строка-граница шапки, пропал раздел
канона, пустая колонка «Источник (цитата)», пустой блок сценария приёмки, строки-заглушки в
таблицах. `/bft-fast` и `/bft-deep` прогоняют линтер перед каждой записью файла и не
сохраняют документ с ошибками. Самотест самого линтера:

```bash
bash <skills_path>/bft-writer/scripts/test-bft-lint.sh
```

Ссылки самих команд и навыков на ресурсы проверяет отдельный линтер — он разворачивает
виртуальную установку всех раскладок `install.sh` и падает, если ссылка не резолвится
хотя бы в одной (корневая `skills/…` после установки не резолвится нигде):

```bash
python3 <skills_path>/bft-writer/scripts/bft-paths-lint.py
```

Карту контекста `/bft-recon` проверяет свой линтер (гейт 20) — находка без ссылки
непроверяема, а отсутствие раздела «Что не найдено» выдаёт молчание за пустой результат:

```bash
python3 <skills_path>/bft-writer/scripts/bft-recon-lint.py .bft/documentation/<epic_slug>/context_map.md
bash <skills_path>/bft-writer/scripts/test-bft-recon-lint.sh
```

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
| `/bft-fast` | Fast lane | письмо + csv-вложения + документ (шапка) + Confluence-черновик |
| `/bft-recon` | Разведка контекста | `context_map.md` — карта находок JIRA/Confluence со ссылками |
| `/bft-deep` | Deep swarm | тот же документ, обогащённый каноном |

## Как это работает

Пайплайн якорится на `.bft/index/` — само-генерируемый набор markdown-пакетов
(архитектура, домен-правила, решения, глоссарий, стейкхолдеры, реестр якорей). `/bft-index`
собирает их из локальных доков, кода (через serena MCP) и трекера (JIRA/Confluence MCP,
опционально). Каждый факт в БФТ прослеживается до источника; неизвестное помечается
`[УТОЧНИТЬ]`, не выдумывается.
