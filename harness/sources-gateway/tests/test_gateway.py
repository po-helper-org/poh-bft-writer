"""Шлюз источников: наружу — только четыре инструмента чтения, остальное закрыто.

Запуск (из harness/sources-gateway):
    python -m pytest -q tests
Шлюз стартует отдельным процессом (как под systemd), ребёнок — заглушка
tests/stub_child.py, у которой много инструментов, ресурс и промпт.
"""

from __future__ import annotations

import asyncio
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport
from fastmcp.exceptions import ToolError

HERE = Path(__file__).resolve().parent
GATEWAY = HERE.parent / "bft_sources_gateway.py"
STUB = HERE / "stub_child.py"
TOKEN = "test-token-not-a-secret-0123456789abcdef"
ALLOWED = {"jira_search", "jira_get_issue", "confluence_search", "confluence_get_page"}
FORBIDDEN = [
    "jira_create_issue",
    "jira_update_issue",
    "confluence_update_page",
    "confluence_create_page",
    "delete_issue",
    "delete_page",
    "shell",
    # Трюки с именем: регистр, префиксы, пространства имён, пробелы, суффиксы.
    "Jira_Search",
    "JIRA_SEARCH",
    "jira_search_admin",
    " jira_search",
    "jira_search ",
    "jira_search\n",
    "atlassian_jira_search",
    "atlassian/jira_search",
    "atlassian:jira_search",
    "jira_search,shell",
    "",
]


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def gateway(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("gw")
    import hashlib

    hash_file = tmp / "token.sha256"
    hash_file.write_text(hashlib.sha256(TOKEN.encode()).hexdigest() + "\n")
    os.chmod(hash_file, 0o600)
    calls = tmp / "calls.log"
    calls.write_text("")
    dump = tmp / "env.json"
    port = _free_port()
    env = {
        **os.environ,
        # То, что ребёнок должен получить…
        "JIRA_URL": "https://jira.invalid",
        "JIRA_PERSONAL_TOKEN": "pat-jira-test",
        # …и то, что не должен.
        "SECRET_OF_OTHER_AGENT": "nope",
        "ANTHROPIC_API_KEY": "nope",
    }
    proc = subprocess.Popen(
        [
            sys.executable,
            str(GATEWAY),
            "--port",
            str(port),
            "--token-sha256-file",
            str(hash_file),
            "--child-command",
            sys.executable,
            "--",
            str(STUB),
            "--stub-calls-log",
            str(calls),
            "--stub-env-dump",
            str(dump),
            # Попытка снять ограничения через аргументы конфигурации — шлюз их уберёт.
            "--enabled-tools",
            "shell",
            "--no-read-only",
        ],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    url = f"http://127.0.0.1:{port}/mcp"
    deadline = time.time() + 30
    while time.time() < deadline:
        try:
            httpx.get(url, timeout=1)
            break
        except httpx.HTTPError:
            if proc.poll() is not None:
                raise RuntimeError(proc.stdout.read().decode())
            time.sleep(0.2)
    else:
        proc.kill()
        raise RuntimeError("шлюз не поднялся")
    yield {"url": url, "calls": calls, "dump": dump, "proc": proc, "hash_file": hash_file}
    proc.terminate()
    try:
        proc.wait(10)
    except subprocess.TimeoutExpired:
        proc.kill()
    out = proc.stdout.read().decode(errors="replace")
    # Значения токенов в журнал не попадают.
    assert TOKEN not in out
    assert "pat-jira-test" not in out


def _client(url: str, token: str | None = TOKEN) -> Client:
    headers = {"Authorization": f"Bearer {token}"} if token is not None else {}
    return Client(StreamableHttpTransport(url, headers=headers))


def run(coro):
    return asyncio.run(coro)


def _calls(gw) -> list[str]:
    return [l for l in gw["calls"].read_text().splitlines() if l]


def _rpc(url: str, method: str, params: dict | None = None, token: str | None = TOKEN):
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    body = {"jsonrpc": "2.0", "id": 1, "method": method}
    if params is not None:
        body["params"] = params
    r = httpx.post(url, headers=headers, json=body, timeout=30)
    if r.status_code != 200:
        return r.status_code, None
    text = r.text
    if r.headers.get("content-type", "").startswith("text/event-stream"):
        data = [l[5:].strip() for l in text.splitlines() if l.startswith("data:")]
        text = data[-1]
    return r.status_code, json.loads(text)


# --------------------------------------------------------------------------- вход


def test_no_token_is_401(gateway):
    r = httpx.post(gateway["url"], json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert r.status_code == 401
    # Чужая схема вместо Bearer — тоже 401.
    r = httpx.post(gateway["url"], headers={"Authorization": f"Basic {TOKEN}"},
                   json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert r.status_code == 401
    # GET (SSE-поток) в режиме без сессий не обслуживается вовсе.
    assert httpx.get(gateway["url"]).status_code in (401, 405)


@pytest.mark.parametrize("token", ["wrong", TOKEN + "x", TOKEN.upper(), TOKEN[:-1]])
def test_wrong_token_is_401(gateway, token):
    code, _ = _rpc(gateway["url"], "tools/list", token=token)
    assert code == 401


def test_hash_file_change_takes_effect_without_restart(gateway):
    """Отзыв и ротация: удаление или замена token.sha256 действуют сразу."""
    import hashlib

    hash_file = gateway["hash_file"]
    original = hash_file.read_text()
    try:
        assert _rpc(gateway["url"], "tools/list")[0] == 200
        hash_file.unlink()
        assert _rpc(gateway["url"], "tools/list")[0] == 401
        new = "rotated-token-not-a-secret-abcdef0123456789"
        hash_file.write_text(hashlib.sha256(new.encode()).hexdigest() + "\n")
        assert _rpc(gateway["url"], "tools/list")[0] == 401
        assert _rpc(gateway["url"], "tools/list", token=new)[0] == 200
        hash_file.write_text("испорчен\n")
        assert _rpc(gateway["url"], "tools/list", token=new)[0] == 401
    finally:
        hash_file.write_text(original)
        os.chmod(hash_file, 0o600)
    assert gateway["proc"].poll() is None
    assert _rpc(gateway["url"], "tools/list")[0] == 200


def test_verifier_unit(tmp_path):
    import hashlib

    sys.path.insert(0, str(GATEWAY.parent))
    import bft_sources_gateway as gw

    f = tmp_path / "h"
    f.write_text(hashlib.sha256(b"a").hexdigest())
    v = gw.Sha256TokenVerifier(hash_file=f)
    assert run(v.verify_token("a")) is not None
    assert run(v.verify_token("b")) is None
    assert run(v.verify_token("")) is None
    f.unlink()
    assert run(v.verify_token("a")) is None
    with pytest.raises(ValueError):
        gw.Sha256TokenVerifier()
    with pytest.raises(ValueError):
        gw.Sha256TokenVerifier(hashlib.sha256(b"a").hexdigest(), hash_file=f)


def test_no_oauth_endpoints(gateway):
    base = gateway["url"].rsplit("/mcp", 1)[0]
    for path in (
        "/.well-known/oauth-authorization-server",
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
        "/authorize",
        "/token",
        "/register",
    ):
        assert httpx.get(base + path).status_code in (401, 404, 405), path


# --------------------------------------------------------------------------- инструменты


def test_lists_exactly_four_tools(gateway):
    async def go():
        async with _client(gateway["url"]) as c:
            return {t.name for t in await c.list_tools()}

    assert run(go()) == ALLOWED


def test_allowed_tools_work(gateway):
    async def go():
        async with _client(gateway["url"]) as c:
            out = {}
            out["jira_search"] = await c.call_tool("jira_search", {"jql": "project = X"})
            out["jira_get_issue"] = await c.call_tool("jira_get_issue", {"issue_key": "X-1"})
            out["confluence_search"] = await c.call_tool("confluence_search", {"query": "q"})
            out["confluence_get_page"] = await c.call_tool("confluence_get_page", {"page_id": "1"})
            return out

    res = run(go())
    assert res["jira_search"].content[0].text == "stub:jira_search:project = X"
    assert res["jira_get_issue"].content[0].text == "stub:jira_get_issue:X-1"
    for name in ALLOWED:
        assert name in _calls(gateway)


@pytest.mark.parametrize("name", FORBIDDEN)
def test_forbidden_tools_rejected_and_never_reach_child(gateway, name):
    before = _calls(gateway)

    async def go():
        async with _client(gateway["url"]) as c:
            with pytest.raises((ToolError, Exception)):
                await c.call_tool(name, {})

    run(go())
    # Также сырым JSON-RPC, мимо клиентской библиотеки.
    code, body = _rpc(gateway["url"], "tools/call", {"name": name, "arguments": {}})
    assert code == 200
    assert "error" in body or body.get("result", {}).get("isError") is True
    assert _calls(gateway) == before


def test_tool_name_wrong_type_rejected(gateway):
    before = _calls(gateway)
    for bad in (["jira_search"], {"name": "jira_search"}, 1, None):
        code, body = _rpc(gateway["url"], "tools/call", {"name": bad, "arguments": {}})
        assert code == 200 and "error" in body
    assert _calls(gateway) == before


# --------------------------------------------------------------------------- ресурсы, промпты, прочее


def test_resources_and_prompts_closed(gateway):
    async def go():
        async with _client(gateway["url"]) as c:
            assert await c.list_resources() == []
            assert await c.list_resource_templates() == []
            assert await c.list_prompts() == []
            with pytest.raises(Exception):
                await c.read_resource("secret://token")
            with pytest.raises(Exception):
                await c.read_resource("file://etc/passwd")
            with pytest.raises(Exception):
                await c.get_prompt("leak")

    before = _calls(gateway)
    run(go())
    for method, params in (
        ("resources/read", {"uri": "secret://token"}),
        ("resources/read", {"uri": "file:///etc/passwd"}),
        ("prompts/get", {"name": "leak"}),
    ):
        code, body = _rpc(gateway["url"], method, params)
        assert code == 200 and "error" in body, method
    assert _calls(gateway) == before


@pytest.mark.parametrize(
    "method,params",
    [
        ("logging/setLevel", {"level": "debug"}),
        ("completion/complete", {"ref": {"type": "ref/prompt", "name": "leak"}, "argument": {"name": "a", "value": "b"}}),
        ("resources/subscribe", {"uri": "secret://token"}),
        ("tasks/list", {}),
        ("tasks/get", {"taskId": "x"}),
        ("tools/execute", {"name": "shell"}),
    ],
)
def test_other_methods_not_found(gateway, method, params):
    code, body = _rpc(gateway["url"], method, params)
    assert code == 200
    assert "error" in body


# --------------------------------------------------------------------------- ребёнок


def test_child_started_read_only_with_minimal_env(gateway):
    run(_list(gateway))
    info = json.loads(gateway["dump"].read_text())
    args = info["args"]
    assert "--read-only" in args
    assert "--no-read-only" not in args
    i = args.index("--enabled-tools")
    assert args.count("--enabled-tools") == 1
    assert set(args[i + 1].split(",")) == ALLOWED
    assert args[args.index("--env-file") + 1] == os.devnull
    assert info["values"]["READ_ONLY_MODE"] == "true"
    assert set(info["values"]["ENABLED_TOOLS"].split(",")) == ALLOWED
    env = set(info["env"])
    assert {"JIRA_URL", "JIRA_PERSONAL_TOKEN"} <= env
    assert "SECRET_OF_OTHER_AGENT" not in env
    assert "ANTHROPIC_API_KEY" not in env


async def _list(gw):
    async with _client(gw["url"]) as c:
        await c.list_tools()


def test_child_args_filter_unit():
    sys.path.insert(0, str(GATEWAY.parent))
    import bft_sources_gateway as g

    out = g.child_args(
        ["--jira-url", "https://j", "--enabled-tools=shell", "--toolsets", "all",
         "--no-read-only", "--transport", "sse", "--env-file", "/home/x/.env"]
    )
    assert out[:2] == ["--jira-url", "https://j"]
    assert "shell" not in out and "sse" not in out and "/home/x/.env" not in out
    assert out.count("--enabled-tools") == 1 and "--read-only" in out
    assert not g.is_allowed_tool("JIRA_SEARCH") and g.is_allowed_tool("jira_search")
