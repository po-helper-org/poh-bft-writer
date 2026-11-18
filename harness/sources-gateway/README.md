# Шлюз источников портала (Jira и Confluence только на чтение)

Решение — [ADR-0015](../docs/adr/0015-shlyuz-istochnikov-tolko-chtenie.md).
Отдельный процесс на сервере: MCP-сервер (Streamable HTTP, `127.0.0.1:3086/mcp`),
который отдаёт порталу ровно четыре инструмента — `jira_search`, `jira_get_issue`,
`confluence_search`, `confluence_get_page` — проксируя их дочернему `mcp-atlassian`
(stdio, `--read-only --enabled-tools <четыре>`). Ресурсов и промптов нет, прочие
методы MCP — «method not found», вход — bearer-токен (шлюз хранит только sha256).

| Файл | Что это |
|---|---|
| `bft_sources_gateway.py` | шлюз: прокси, белый список, проверка токена |
| `build_env.py` | окружение шлюза из конфигурации MCP-клиента (адреса и ключи Jira/Confluence) |
| `bft-sources-gateway.service` | шаблон сервиса `systemd --user` с песочницей |
| `requirements*.txt` | закреплённые версии (шлюз, `mcp-atlassian`, тесты) |
| `tests/` | тесты на заглушке ребёнка, у которой много опасных инструментов |

Установка и обновление на сервере — `harness/deploy/install-sources-gateway.sh`
(без sudo); наружу — `location = /bft-sources/mcp` в `harness/deploy/bft-portal.nginx.conf`.

Тесты локально:

```bash
uv venv .venv && uv pip install --python .venv/bin/python -r requirements-test.txt
.venv/bin/python -m pytest -q tests
```
