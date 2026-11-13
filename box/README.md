# poh-bft-box — коробка БФТ

Оркестратор подготовки бизнес-функциональных требований (БФТ). На вход — цель и бриф, на выход — пакет БФТ
(документ, матрица исполнения, BluePrint-карта, эпик), который коробка **не выпускает на приёмку, пока он не прошёл
проверки качества**. Процесс инициативы ведёт Temporal: итерации, таймеры сроков указаний и повторы вызовов модели
переживают рестарт. Людей, Jira и Confluence трогают внешние исполнители (например, агенты Hermes) по указаниям
коробки: у самой коробки своих каналов нет. Решения — [ADR 0001](docs/adr/0001-korobka-mozg-ispolniteli-ruki.md),
[ADR 0002](docs/adr/0002-otdelnyj-repo-temporal-compose.md), словарь — [GLOSSARY](docs/GLOSSARY.md),
контракт — [CONTRACT](docs/CONTRACT.md).

```
исполнитель (Hermes, Claude, страница /bft)
   │  MCP / HTTP + Bearer         start · submit · get · status · control · list
   ▼
box-mcp ──▶ Temporal ──▶ box-worker ──▶ модель (OpenAI-совместимый API)
   │        (воркфлоу =      │  проверки качества кодом поверх ответа модели
   │         инициатива)     ▼
   └────────── Postgres ◀── persist  (то, что читают get / status / list и страница /bft)
```

## Запуск

```bash
cp .env.example .env     # POSTGRES_PASSWORD, BOX_TOKENS, модель (LLM_*)
docker compose up -d     # postgres, temporal, box-worker, box-mcp
docker compose --profile debug up -d   # + Temporal UI на 127.0.0.1:8233 (ссылки со страницы /bft ведут туда)
```

**Попробовать без ключа модели** — демо-двойник (это не ИИ: фиксированный сценарий, показывает жизненный цикл и
светофор, но не качество текста): в `.env` задать `LLM_BASE_URL=http://llm-demo:8710/v1`, `LLM_API_KEY=demo`, затем

```bash
docker compose --profile demo --profile debug up -d
BOX_TOKEN=<токен hermes из BOX_TOKENS> python scripts/smoke.py   # бриф → план → проработка → приёмка → принято
```

Память (замер на этом стеке): postgres ≈ 140 МБ, temporal ≈ 60–400 МБ, воркер и MCP по ≈ 60 МБ; лимиты заданы в compose.
Корпоративное (шаблоны команд, замечания ревью, свои проверки) — вне репозитория: `CHECKS_FILE`, `PROMPTS_DIR`.

## Без Docker (сервер под systemd --user)

Если у пользователя нет docker (нет прав или compose), коробка ставится одним скриптом без sudo: Temporal — dev-сервер на SQLite
(`temporal server start-dev`), данные коробки — SQLite (`DATABASE_URL=sqlite:///путь/box.db`), процессы — юниты пользователя
`poh-bft-temporal`, `poh-bft-worker`, `poh-bft-mcp` с лимитами памяти. Токены создаются один раз и не печатаются.

```bash
bash deploy/native/install.sh --llm-base http://127.0.0.1:8642/p/bft-ai/v1 --llm-key-file ~/.config/…/key --no-json-mode
```

`LLM_API_KEY_FILE` — ключ модели из файла (читается на каждый вызов, ключ можно сменить без рестарта); `LLM_JSON_MODE=0` — не слать
`response_format`, если шлюз его не знает. В compose по-прежнему Postgres.

## Как коробка не выпускает непроработанное

Модель предлагает пакет, светофор и указания. Всё, что проверяется кодом, проверяется кодом
([`bftbox/quality.py`](bftbox/quality.py), [`bftbox/engine.py`](bftbox/engine.py)):

- светофор строится по каталогу проверок ([`config/checks.json`](config/checks.json)); пропущенная проверка — красная;
- зелёная без доказательства — жёлтая; цитата-якорь в «ёлочках» должна быть в брифе, файлах, исходах или документах;
- проверка «нет документа» (RACI, эпик, BluePrint) и «нет раздела» (Границы, Открытые вопросы) не бывает зелёной;
- в приёмку ведёт только зелёный светофор при утверждённом плане, без открытых указаний и с обязательными разделами;
  приёмка — решение PO (`accept_package`), вернуть можно с замечанием;
- переходы состояний — только допустимые; людям не адресуются указания до утверждения плана, адресат вне плана
  превращается в `approve_plan_change` к PO; решения PO принимаются только с `by_role=po`;
- красная несколько итераций подряд на проработке → «Нужен PO» с указанием `decide`;
- сбой модели после 3 попыток → итерация со статусом `error`, указания прошлой итерации остаются в силе.

## Мониторинг (Grafana)

`box-mcp` отдаёт `GET /metrics` (состояние инициатив из Postgres в момент опроса: состояния, итерации, светофор по проверкам,
указания, зависшие итерации), `box-worker` — `:9101/metrics` (время и исходы вызовов модели). Порты — на `127.0.0.1`
(`BOX_BIND`). Метки — только перечислимые значения: ни целей, ни id инициатив, ни текстов в метриках нет.
Дашборд «Коробка БФТ» и три алерта (нет метрик 5 мин, итерация готовится > 15 мин, > 2 сбоев модели за 15 мин) лежат в
[poh-observability](https://github.com/po-helper-org/poh-observability) (`grafana/dashboards/bft-box.json`, группа правил «Коробка БФТ»),
сбор — job `bft-box` в `collector/config.yaml`.

| Метрика | Что показывает |
|---|---|
| `bft_box_initiatives{state}` | воронка: инициативы по состояниям |
| `bft_box_waiting_po` | инициативы с неотвеченным указанием к PO |
| `bft_box_iterations_total{trigger,status}` | итерации по причине начала и исходу (`ready` / `error` / `preparing`) |
| `bft_box_oldest_preparing_seconds` | возраст самой долгой готовящейся итерации (зависание) |
| `bft_box_checks{check,status}` | светофор последних итераций по проверкам каталога |
| `bft_box_checks_downgraded` | зелёные, которые код понизил: модель завысила |
| `bft_box_directives{kind,state}` | невыполненные указания, в том числе `overdue` |
| `bft_box_llm_calls_total{outcome}`, `bft_box_llm_seconds` | вызовы модели: исход и время |

## Протокол

MCP-инструменты `start`, `submit`, `get` (json или markdown), `status`, `control` (`pause`, `resume`, `cancel`,
`reopen`), `list`. Исполнитель опознаётся по токену из `BOX_TOKENS` и пишет только в свои инициативы; идемпотентность
по ключу, `conflict`, `not_ready`, версии схемы — по [контракту 1.0.0](docs/CONTRACT.md): схема и 28 эталонов лежат
в `bftbox/protocol.schema.json` и `tests/contract/`.

Для страницы `/bft` (токен из `BOX_ADMINS`, видит все инициативы): `GET /api/board`, `GET /api/initiative/{id}`,
`POST /api/start|submit|control` — в карточке есть `temporal_url` на процесс в Temporal UI.

## Проверка

```bash
pip install -r requirements.txt -r requirements-dev.txt
pytest                      # 32 теста: 28 эталонов контракта, проверки качества, воркфлоу на тестовом Temporal
```

## Ограничения (честно)

- **Качество текста БФТ на реальной модели не измерено**: тесты и демо идут на двойнике модели. Прогон на реальных запросах
  с оценкой по эталонам `poh-bft-writer` — отдельный шаг; без него «всегда качественный БФТ» не доказан.
  Код гарантирует структуру и честность светофора, а не содержательную глубину.
- Воркфлоу живёт, пока инициатива может быть открыта заново; `continue-as-new` для очень длинных историй не реализован.
- Токены статические (`BOX_TOKENS`), без выдачи и ротации.
- Файлы-вложения: читаются только текстовые; бинарные модель видит как имена.
