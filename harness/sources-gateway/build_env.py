"""Окружение шлюза источников из конфигурации MCP-клиента (ADR-0015).

    python build_env.py <config.yaml> <server-name> <out-env-file>

Читает mcp_servers.<server-name> (или mcpServers.<server-name>) из YAML-конфигурации
любого MCP-клиента вида {command, args, env}, берёт из неё только адреса Jira и
Confluence и их ключи, и пишет файл KEY=VALUE для EnvironmentFile= systemd (права 600,
атомарная замена). Значения вида ${VAR} или $VAR подставляются из .env рядом с YAML.

Значения не печатаются никогда — только имена найденных ключей.
"""

from __future__ import annotations

import os
import re
import sys
import tempfile
from pathlib import Path

import yaml

# Ключи окружения, которые переносятся (совпадают с CHILD_ENV_KEYS шлюза).
ENV_KEYS = (
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
)
# Аргументы mcp-atlassian со значением → ключ окружения.
ARG_KEYS = {
    "--jira-url": "JIRA_URL",
    "--confluence-url": "CONFLUENCE_URL",
    "--jira-personal-token": "JIRA_PERSONAL_TOKEN",
    "--confluence-personal-token": "CONFLUENCE_PERSONAL_TOKEN",
    "--jira-username": "JIRA_USERNAME",
    "--jira-token": "JIRA_API_TOKEN",
    "--confluence-username": "CONFLUENCE_USERNAME",
    "--confluence-token": "CONFLUENCE_API_TOKEN",
    "--jira-projects-filter": "JIRA_PROJECTS_FILTER",
    "--confluence-spaces-filter": "CONFLUENCE_SPACES_FILTER",
}
# Флаги без значения.
FLAG_KEYS = {
    "--jira-ssl-verify": ("JIRA_SSL_VERIFY", "true"),
    "--no-jira-ssl-verify": ("JIRA_SSL_VERIFY", "false"),
    "--confluence-ssl-verify": ("CONFLUENCE_SSL_VERIFY", "true"),
    "--no-confluence-ssl-verify": ("CONFLUENCE_SSL_VERIFY", "false"),
}
_VAR = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)")


class ConfigError(Exception):
    pass


def read_dotenv(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, sep, value = line.partition("=")
        if not sep:
            continue
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        elif " #" in value:
            value = value.split(" #", 1)[0].rstrip()
        out[key] = value
    return out


def resolve(value: object, dotenv: dict[str, str], where: str) -> str:
    text = "" if value is None else str(value)

    def sub(m: re.Match) -> str:
        name = m.group(1) or m.group(2)
        if name not in dotenv:
            raise ConfigError(f"{where}: переменная {name} не найдена в .env рядом с конфигурацией")
        return dotenv[name]

    return _VAR.sub(sub, text)


def extract(config_path: Path, server: str) -> dict[str, str]:
    try:
        data = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError) as e:
        raise ConfigError(f"не читается конфигурация {config_path}: {type(e).__name__}") from None
    servers = None
    for key in ("mcp_servers", "mcpServers", "servers"):
        if isinstance(data.get(key), dict):
            servers = data[key]
            break
    if servers is None:
        raise ConfigError(f"{config_path}: нет раздела mcp_servers")
    entry = servers.get(server)
    if not isinstance(entry, dict):
        raise ConfigError(f"{config_path}: нет сервера «{server}» в mcp_servers")

    dotenv = read_dotenv(config_path.parent / ".env")
    out: dict[str, str] = {}

    args = [resolve(a, dotenv, f"{server}.args") for a in (entry.get("args") or [])]
    i = 0
    while i < len(args):
        arg = args[i]
        flag, eq, val = arg.partition("=")
        if flag in ARG_KEYS:
            if not eq:
                i += 1
                val = args[i] if i < len(args) else ""
            if val:
                out[ARG_KEYS[flag]] = val
        elif arg in FLAG_KEYS:
            k, v = FLAG_KEYS[arg]
            out[k] = v
        i += 1

    env = entry.get("env") or {}
    if not isinstance(env, dict):
        raise ConfigError(f"{server}.env: ожидается словарь")
    for key in ENV_KEYS:
        if key in env and env[key] not in (None, ""):
            value = resolve(env[key], dotenv, f"{server}.env.{key}")
            if value:
                out[key] = value  # env важнее аргументов

    has_jira = "JIRA_URL" in out and ("JIRA_PERSONAL_TOKEN" in out or "JIRA_API_TOKEN" in out)
    has_conf = "CONFLUENCE_URL" in out and (
        "CONFLUENCE_PERSONAL_TOKEN" in out or "CONFLUENCE_API_TOKEN" in out
    )
    if not (has_jira or has_conf):
        raise ConfigError(
            f"{server}: не найдены адрес и ключ ни Jira, ни Confluence "
            "(JIRA_URL + JIRA_PERSONAL_TOKEN / CONFLUENCE_URL + CONFLUENCE_PERSONAL_TOKEN)"
        )
    for k, v in out.items():
        if "\n" in v or "\r" in v or "\0" in v:
            raise ConfigError(f"{server}: значение {k} содержит перевод строки")
    return out


def _quote(value: str) -> str:
    if re.fullmatch(r"[A-Za-z0-9_@%+=:,./~-]*", value):
        return value
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def write_env(values: dict[str, str], out_path: Path, extra: dict[str, str] | None = None) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    lines = ["# bft-sources-gateway: создано harness/deploy/install-sources-gateway.sh — не править руками"]
    for k, v in {**values, **(extra or {})}.items():
        lines.append(f"{k}={_quote(v)}")
    old = os.umask(0o077)
    try:
        fd, tmp = tempfile.mkstemp(dir=out_path.parent, prefix=".env.")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        os.chmod(tmp, 0o600)
        os.replace(tmp, out_path)
    finally:
        os.umask(old)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__.strip().splitlines()[2].strip(), file=sys.stderr)
        return 2
    config, server, out = Path(argv[0]), argv[1], Path(argv[2])
    extra = {k: os.environ[k] for k in ("BFT_GW_HOST", "BFT_GW_PORT", "BFT_GW_PATH") if os.environ.get(k)}
    try:
        values = extract(config, server)
    except ConfigError as e:
        print(f"✗ {e}", file=sys.stderr)
        return 1
    write_env(values, out, extra)
    print("✓ окружение шлюза: " + ", ".join(sorted(values)) + " (значения не выводятся)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
