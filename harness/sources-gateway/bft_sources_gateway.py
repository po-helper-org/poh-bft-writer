"""Шлюз источников БФТ-портала: Jira и Confluence только на чтение (ADR-0015).

Маленький MCP-сервер (Streamable HTTP, по умолчанию 127.0.0.1:3086/mcp), который
отдаёт порталу РОВНО четыре инструмента — jira_search, jira_get_issue,
confluence_search, confluence_get_page — проксируя их дочернему mcp-atlassian (stdio).

Слои защиты (каждый сам по себе закрывает всё, кроме четырёх инструментов):
  1. Дочерний mcp-atlassian стартует с --read-only и --enabled-tools <четыре>
     (и READ_ONLY_MODE=true, ENABLED_TOOLS=<четыре> в окружении), --env-file /dev/null —
     чужие .env он не подхватит. Окружение ребёнка — только ключи Jira/Confluence.
  2. Провайдер-прокси шлюза видит у ребёнка только четыре имени; ресурсы, шаблоны
     ресурсов и промпты не запрашиваются у ребёнка вовсе — их нет.
  3. Middleware: tools/list и tools/call — только точное совпадение имени из списка,
     чтение ресурсов и промптов — отказ.
  4. Низкоуровневые обработчики MCP, кроме нужных, сняты (logging/setLevel и т. п.):
     такие методы получают «method not found».
  5. Вход — статический bearer-токен; шлюз хранит только его sha256 (файл 0600),
     сравнение — постоянного времени. Без токена или с чужим — HTTP 401. OAuth нет.
  6. Обратные запросы ребёнка к клиенту (sampling, elicitation, roots) не пробрасываются.

Значения токенов и ключей шлюз не пишет в журнал.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import logging
import os
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import mcp.types as mt
from fastmcp import Client, FastMCP
from fastmcp.client.transports import StdioTransport
from fastmcp.server.auth import AccessToken, TokenVerifier
from fastmcp.server.middleware import Middleware, MiddlewareContext
from fastmcp.server.providers.proxy import ProxyProvider
from mcp import McpError
from mcp.types import METHOD_NOT_FOUND, ErrorData

log = logging.getLogger("bft-sources-gateway")

# Единственные инструменты, которые шлюз вообще способен вызвать.
ALLOWED_TOOLS: frozenset[str] = frozenset(
    {"jira_search", "jira_get_issue", "confluence_search", "confluence_get_page"}
)
ALLOWED_TOOLS_CSV = ",".join(sorted(ALLOWED_TOOLS))

# Методы MCP, которые доходят до сервера. Остальное — «method not found».
ALLOWED_METHODS: frozenset[str] = frozenset(
    {
        "initialize",
        "ping",
        "tools/list",
        "tools/call",
        # Списки отдаются пустыми — клиенты MCP их часто запрашивают при подключении.
        "resources/list",
        "resources/templates/list",
        "prompts/list",
    }
)
# Низкоуровневые обработчики, которые остаются у сервера (initialize обрабатывает сессия).
_KEEP_HANDLERS: frozenset[type] = frozenset(
    {
        mt.PingRequest,
        mt.ListToolsRequest,
        mt.CallToolRequest,
        mt.ListResourcesRequest,
        mt.ListResourceTemplatesRequest,
        mt.ListPromptsRequest,
        # Чтение ресурса и промпта остаются, чтобы отказ был понятной ошибкой MCP,
        # а не обрывом: их всё равно отклоняют провайдер и middleware.
        mt.ReadResourceRequest,
        mt.GetPromptRequest,
    }
)

# Ключи окружения, которые получает дочерний mcp-atlassian (всё прочее не передаётся).
CHILD_ENV_KEYS: tuple[str, ...] = (
    "JIRA_URL",
    "CONFLUENCE_URL",
    "JIRA_PERSONAL_TOKEN",
    "CONFLUENCE_PERSONAL_TOKEN",
    "JIRA_USERNAME",
    "JIRA_API_TOKEN",
    "CONFLUENCE_USERNAME",
    "CONFLUENCE_API_TOKEN",
    "JIRA_SSL_VERIFY",
    "CONFLUENCE_SSL_VERIFY",
    "JIRA_PROJECTS_FILTER",
    "CONFLUENCE_SPACES_FILTER",
    "MCP_ATLASSIAN_USE_SYSTEM_TRUSTSTORE",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
)
# Флаги ребёнка, которые шлюз задаёт сам; такие же флаги из конфигурации отбрасываются.
_FORCED_FLAGS_WITH_VALUE = {"--enabled-tools", "--toolsets", "--transport", "--env-file", "--port", "--host", "--path"}
_FORCED_FLAGS = {"--read-only", "--stateless", "--oauth-setup"}


def _deny(message: str) -> McpError:
    return McpError(ErrorData(code=METHOD_NOT_FOUND, message=message))


def is_allowed_tool(name: Any) -> bool:
    """Точное совпадение строки: без регистра, пробелов, префиксов и пространств имён."""
    return isinstance(name, str) and name in ALLOWED_TOOLS


# --------------------------------------------------------------------------- токен


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def read_token_hash(path: Path) -> str:
    value = path.read_text(encoding="ascii").strip().lower()
    if len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
        raise ValueError(f"{path}: ожидается sha256 токена (64 hex-символа)")
    return value


class Sha256TokenVerifier(TokenVerifier):
    """Статический bearer-токен; в памяти и на диске — только sha256.

    С ``hash_file`` файл хэша перечитывается при каждом изменении (mtime, размер,
    inode): удаление или замена файла действует сразу, без перезапуска. Нет
    файла или он испорчен — любой токен отклоняется (401).
    """

    def __init__(self, token_sha256: str | None = None, *, hash_file: Path | None = None):
        super().__init__()
        if (token_sha256 is None) == (hash_file is None):
            raise ValueError("нужен ровно один из token_sha256 / hash_file")
        self._hash_file = hash_file
        self._stamp: tuple | None = None
        self._expected: bytes | None = bytes.fromhex(token_sha256) if token_sha256 else None

    def _current(self) -> bytes | None:
        if self._hash_file is None:
            return self._expected
        try:
            st = self._hash_file.stat()
        except OSError:
            self._stamp, self._expected = None, None
            return None
        stamp = (st.st_mtime_ns, st.st_size, st.st_ino)
        if stamp != self._stamp:
            try:
                self._expected = bytes.fromhex(read_token_hash(self._hash_file))
            except (OSError, ValueError):
                self._expected = None
                log.warning("файл хэша токена недоступен или испорчен — все запросы отклоняются")
            self._stamp = stamp
        return self._expected

    async def verify_token(self, token: str) -> AccessToken | None:
        expected = self._current()
        if not token or expected is None:
            return None
        got = hashlib.sha256(token.encode("utf-8")).digest()
        if not hmac.compare_digest(got, expected):
            return None
        return AccessToken(token="[bft-portal]", client_id="bft-portal", scopes=[])


# --------------------------------------------------------------------------- прокси


class ReadOnlyAtlassianProvider(ProxyProvider):
    """Прокси к ребёнку, который знает только четыре инструмента и ничего больше."""

    async def _list_tools(self):  # type: ignore[override]
        tools = await super()._list_tools()
        allowed = [t for t in tools if is_allowed_tool(t.name)]
        # Кэш для _get_tool — тоже только разрешённые.
        if self._tools_cache is not None:
            self._tools_cache.items = allowed
        return allowed

    async def _get_tool(self, name, version=None):  # type: ignore[override]
        if not is_allowed_tool(name):
            return None
        tool = await super()._get_tool(name, version)
        if tool is None or not is_allowed_tool(tool.name):
            return None
        # Имя, под которым вызов уйдёт ребёнку, — тоже из списка.
        if not is_allowed_tool(getattr(tool, "_backend_name", None) or tool.name):
            return None
        return tool

    async def _list_resources(self):  # type: ignore[override]
        return []

    async def _get_resource(self, uri, version=None):  # type: ignore[override]
        return None

    async def _list_resource_templates(self):  # type: ignore[override]
        return []

    async def _get_resource_template(self, uri, version=None):  # type: ignore[override]
        return None

    async def _list_prompts(self):  # type: ignore[override]
        return []

    async def _get_prompt(self, name, version=None):  # type: ignore[override]
        return None

    async def get_tasks(self):  # type: ignore[override]
        return []


class AllowlistMiddleware(Middleware):
    """Второй рубеж: что бы ни вернул провайдер, наружу — только четыре инструмента."""

    async def on_request(self, context: MiddlewareContext, call_next):
        if context.method not in ALLOWED_METHODS:
            raise _deny(f"Метод недоступен: {context.method}")
        return await call_next(context)

    async def on_list_tools(self, context, call_next):
        tools = await call_next(context)
        return [t for t in tools if is_allowed_tool(t.name)]

    async def on_call_tool(self, context, call_next):
        name = getattr(context.message, "name", None)
        if not is_allowed_tool(name):
            log.warning("отклонён вызов инструмента вне списка")
            raise _deny("Инструмент недоступен: шлюз отдаёт только чтение Jira и Confluence")
        return await call_next(context)

    async def on_list_resources(self, context, call_next):
        return []

    async def on_list_resource_templates(self, context, call_next):
        return []

    async def on_list_prompts(self, context, call_next):
        return []

    async def on_read_resource(self, context, call_next):
        raise _deny("Ресурсы недоступны")

    async def on_get_prompt(self, context, call_next):
        raise _deny("Промпты недоступны")


# --------------------------------------------------------------------------- ребёнок


def child_args(extra_args: Sequence[str]) -> list[str]:
    """Аргументы ребёнка: заданные + принудительные флаги только чтения.

    Флаги, которые шлюз задаёт сам (--enabled-tools, --toolsets, --transport,
    --env-file, --read-only…), из заданных аргументов убираются.
    """
    out: list[str] = []
    skip_value = False
    for arg in extra_args:
        if skip_value:
            skip_value = False
            continue
        flag = arg.split("=", 1)[0]
        if flag in _FORCED_FLAGS or flag == "--no-read-only":
            continue
        if flag in _FORCED_FLAGS_WITH_VALUE:
            skip_value = "=" not in arg
            continue
        out.append(arg)
    return out + [
        "--transport",
        "stdio",
        "--read-only",
        "--enabled-tools",
        ALLOWED_TOOLS_CSV,
        # Не искать .env по родительским каталогам.
        "--env-file",
        os.devnull,
    ]


def child_env(source: Mapping[str, str]) -> dict[str, str]:
    env = {k: source[k] for k in CHILD_ENV_KEYS if source.get(k)}
    env["READ_ONLY_MODE"] = "true"
    env["ENABLED_TOOLS"] = ALLOWED_TOOLS_CSV
    env["TOOLSETS"] = "all"  # отбор — только по ENABLED_TOOLS
    env["FASTMCP_SHOW_SERVER_BANNER"] = "false"
    return env


def build_server(
    *,
    token_sha256: str | None = None,
    token_sha256_file: Path | None = None,
    child_command: str,
    child_arguments: Sequence[str] = (),
    env_source: Mapping[str, str] | None = None,
    child_cwd: str | None = None,
) -> FastMCP:
    transport = StdioTransport(
        command=child_command,
        args=child_args(child_arguments),
        env=child_env(os.environ if env_source is None else env_source),
        cwd=child_cwd,
        keep_alive=True,
    )
    # Обычный Client, не ProxyClient: обратные запросы ребёнка (sampling, elicitation,
    # roots) к порталу не пробрасываются.
    base = Client(transport, name="bft-sources-gateway-child")

    def client_factory() -> Client:
        return base.new()

    server = FastMCP(
        name="bft-sources-gateway",
        instructions="Jira и Confluence только на чтение: поиск и чтение задач и страниц.",
        auth=Sha256TokenVerifier(token_sha256, hash_file=token_sha256_file),
        middleware=[AllowlistMiddleware()],
    )
    server.add_provider(ReadOnlyAtlassianProvider(client_factory))

    handlers = server._mcp_server.request_handlers
    for request_type in list(handlers):
        if request_type not in _KEEP_HANDLERS:
            del handlers[request_type]
    return server


def build_app(server: FastMCP, path: str = "/mcp"):
    # Host-заголовок не проверяется: за nginx он публичный, доступ решает токен.
    return server.http_app(
        path=path,
        transport="http",
        stateless_http=True,
        host_origin_protection=False,
    )


# --------------------------------------------------------------------------- запуск


def main(argv: Sequence[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--host", default=os.environ.get("BFT_GW_HOST", "127.0.0.1"))
    p.add_argument("--port", type=int, default=int(os.environ.get("BFT_GW_PORT", "3086")))
    p.add_argument("--path", default=os.environ.get("BFT_GW_PATH", "/mcp"))
    p.add_argument(
        "--token-sha256-file",
        default=os.environ.get(
            "BFT_GW_TOKEN_SHA256_FILE",
            str(Path.home() / ".config/bft-sources-gateway/token.sha256"),
        ),
    )
    p.add_argument(
        "--child-command",
        default=os.environ.get("BFT_GW_CHILD_COMMAND", "mcp-atlassian"),
        help="исполняемый файл mcp-atlassian (stdio)",
    )
    p.add_argument(
        "--child-cwd",
        default=os.environ.get("BFT_GW_CHILD_CWD") or None,
    )
    p.add_argument("child_args", nargs="*", help="доп. аргументы ребёнка после --")
    a = p.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    hash_file = Path(a.token_sha256_file).expanduser()
    read_token_hash(hash_file)  # при старте файл обязателен и должен быть корректным
    server = build_server(
        token_sha256_file=hash_file,
        child_command=a.child_command,
        child_arguments=a.child_args,
        child_cwd=a.child_cwd,
    )
    app = build_app(server, a.path)
    log.info("слушаю %s:%s%s; инструменты: %s", a.host, a.port, a.path, ALLOWED_TOOLS_CSV)

    import uvicorn

    uvicorn.run(app, host=a.host, port=a.port, log_level="warning", server_header=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
