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
5. v2 автономка: `/bft-fast` (быстрый черновик из письма) + `/bft-deep` (обогащение swarm).
6. Результат соответствует практикам po-helper: 16 hard gates, стиль/голос, Lessons Learned, корп-шаблон v10, ранги якорей, CATWOE, adversarial-дебаты.

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
| `/bft-fast` | Fast lane | быстрый черновик БФТ |
| `/bft-deep` | Deep swarm | обогащённый БФТ |

## Как это работает

Пайплайн якорится на `.bft/index/` — само-генерируемый набор markdown-пакетов
(архитектура, домен-правила, решения, глоссарий, стейкхолдеры, реестр якорей). `/bft-index`
собирает их из локальных доков, кода (через serena MCP) и трекера (JIRA/Confluence MCP,
опционально). Каждый факт в БФТ прослеживается до источника; неизвестное помечается
`[УТОЧНИТЬ]`, не выдумывается.
