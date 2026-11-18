"""Заглушка дочернего MCP-сервера (stdio) для тестов шлюза.

Нарочно отдаёт много инструментов — в том числе пишущие и опасные — плюс ресурс,
шаблон ресурса и промпт, и игнорирует --read-only/--enabled-tools: шлюз обязан
закрыть всё это сам. Каждый вызов пишет имя инструмента в файл --stub-calls-log,
чтобы тесты видели, что до ребёнка дошло; --stub-env-dump — куда записать имена
переменных окружения и аргументы, с которыми ребёнка запустили.
"""

import json
import os
import sys
from pathlib import Path

from fastmcp import FastMCP

mcp = FastMCP("stub-atlassian")


def _arg(flag: str) -> str | None:
    argv = sys.argv[1:]
    return argv[argv.index(flag) + 1] if flag in argv[:-1] else None


def _record(name: str) -> str:
    log = _arg("--stub-calls-log")
    if log:
        with open(log, "a", encoding="utf-8") as f:
            f.write(name + "\n")
    return f"stub:{name}"


@mcp.tool
def jira_search(jql: str = "") -> str:
    return _record("jira_search") + f":{jql}"


@mcp.tool
def jira_get_issue(issue_key: str = "") -> str:
    return _record("jira_get_issue") + f":{issue_key}"


@mcp.tool
def confluence_search(query: str = "") -> str:
    return _record("confluence_search")


@mcp.tool
def confluence_get_page(page_id: str = "") -> str:
    return _record("confluence_get_page")


@mcp.tool
def jira_create_issue(summary: str = "") -> str:
    return _record("jira_create_issue")


@mcp.tool
def jira_update_issue(issue_key: str = "") -> str:
    return _record("jira_update_issue")


@mcp.tool
def confluence_update_page(page_id: str = "") -> str:
    return _record("confluence_update_page")


@mcp.tool
def confluence_create_page(title: str = "") -> str:
    return _record("confluence_create_page")


@mcp.tool
def delete_issue(issue_key: str = "") -> str:
    return _record("delete_issue")


@mcp.tool
def delete_page(page_id: str = "") -> str:
    return _record("delete_page")


@mcp.tool
def shell(command: str = "") -> str:
    return _record("shell")


@mcp.tool(name="Jira_Search")
def jira_search_case() -> str:
    return _record("Jira_Search")


@mcp.tool(name="jira_search_admin")
def jira_search_admin() -> str:
    return _record("jira_search_admin")


@mcp.resource("secret://token")
def secret() -> str:
    _record("resource:secret")
    return "top-secret"


@mcp.resource("file://{path}")
def any_file(path: str) -> str:
    _record("template:file")
    return "file"


@mcp.prompt
def leak() -> str:
    _record("prompt:leak")
    return "prompt"


if __name__ == "__main__":
    dump = _arg("--stub-env-dump")
    if dump:
        Path(dump).write_text(
            json.dumps({"env": sorted(os.environ), "args": sys.argv[1:],
                        "values": {k: os.environ[k] for k in ("READ_ONLY_MODE", "ENABLED_TOOLS")
                                   if k in os.environ}}),
            encoding="utf-8",
        )
    mcp.run(transport="stdio", show_banner=False)
