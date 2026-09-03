#!/usr/bin/env python3
"""bft-env-lint — проверка конфига MCP перед `/bft-deep` (стадия 0а сетапа).

`/bft-deep` — первая стадия пайплайна, которая ходит наружу: трекер, вики, git,
индекс. Раньше настройка подключений оставалась на PO и нигде не проверялась —
агент молча обнаруживал недоступный `jira_get_issue` и шёл дальше.

Что скрипт может и чего не может. Отвечает ли сервер на самом деле, из файла не
видно: инструмент бывает объявлен, а VPN лежит. Живой вызов делает агент
(`environment_setup.md` §1). Скрипт закрывает вторую половину — форму конфига,
которая из чата не читается и в которой ошибаются молча:

    EN001  файл не найден или не разбирается как JSON
    EN002  нет сервера трекера (jira / atlassian)
    EN003  нет сервера вики (confluence / atlassian)
    EN004  секрет записан значением, а не ссылкой на переменную окружения
    EN005  файл с секретами не закрыт от git

Использование:
    python3 <skills_path>/bft-writer/scripts/bft-env-lint.py .mcp.json
    python3 <skills_path>/bft-writer/scripts/bft-env-lint.py .mcp.json --format json

Коды выхода: 0 — находок нет; 1 — есть ERROR; 2 — файл не прочитан (EN001).
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass, asdict
from pathlib import Path

# Имя сервера произвольно («atlassian», «jira-mts», «corp-wiki»), поэтому источник
# опознаётся по подстроке в имени сервера, команде запуска и аргументах.
TRACKER_MARKERS = ("jira", "atlassian", "tracker", "youtrack")
WIKI_MARKERS = ("confluence", "atlassian", "wiki")

# Ключ, значение которого секретно. Сверяется по подстроке: TOKEN, API_KEY, PASSWORD…
SECRET_KEY_RE = re.compile(r"token|secret|password|api[_-]?key|credential", re.IGNORECASE)

# Ссылка на окружение: ${VAR}, $VAR, %VAR% — значение живёт вне файла.
ENV_REF_RE = re.compile(r"^\s*(\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%)\s*$")

# Заглушки, которые секретом не являются: шаблон для заполнения, а не живой токен.
PLACEHOLDER_VALUES = {"", "...", "<токен>", "<token>", "changeme", "todo", "xxx"}


@dataclass
class Finding:
    level: str
    code: str
    message: str


def load(path: Path) -> tuple[dict | None, Finding | None]:
    if not path.is_file():
        return None, Finding("ERROR", "EN001", f"конфиг MCP не найден: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8-sig")), None
    except json.JSONDecodeError as exc:
        return None, Finding("ERROR", "EN001", f"конфиг MCP не разбирается как JSON: {exc}")


def servers(config: dict) -> dict:
    """Секция серверов. Клиенты называют её по-разному, набор один и тот же."""
    for key in ("mcpServers", "servers", "mcp_servers"):
        section = config.get(key)
        if isinstance(section, dict):
            return section
    return {}


def haystack(name: str, spec: object) -> str:
    """Всё, по чему опознаётся источник: имя сервера, команда, аргументы, url."""
    parts = [name]
    if isinstance(spec, dict):
        for key in ("command", "url", "type"):
            value = spec.get(key)
            if isinstance(value, str):
                parts.append(value)
        args = spec.get("args")
        if isinstance(args, list):
            parts += [a for a in args if isinstance(a, str)]
    return " ".join(parts).lower()


def has_source(section: dict, markers: tuple[str, ...]) -> bool:
    return any(
        any(m in haystack(name, spec) for m in markers)
        for name, spec in section.items()
    )


def inline_secrets(section: dict) -> list[tuple[str, str]]:
    """Секретные ключи, чьё значение записано прямо в файле, а не ссылкой на окружение."""
    found: list[tuple[str, str]] = []
    for name, spec in section.items():
        if not isinstance(spec, dict):
            continue
        env = spec.get("env")
        pairs = list(env.items()) if isinstance(env, dict) else []
        for key in ("url", "command"):  # секрет иногда прячут в query-строке url
            value = spec.get(key)
            if isinstance(value, str):
                pairs.append((key, value))
        for key, value in pairs:
            if not isinstance(value, str) or not SECRET_KEY_RE.search(key):
                continue
            if ENV_REF_RE.match(value) or value.strip().lower() in PLACEHOLDER_VALUES:
                continue
            found.append((name, key))
    return found


def git_ignored(path: Path) -> bool | None:
    """Закрыт ли файл от git. None — вне репозитория, вопрос не стоит."""
    try:
        inside = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=path.resolve().parent, capture_output=True, text=True, timeout=10)
        if inside.returncode != 0 or inside.stdout.strip() != "true":
            return None
        ignored = subprocess.run(
            ["git", "check-ignore", "-q", str(path)],
            cwd=path.resolve().parent, capture_output=True, timeout=10)
        return ignored.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return None


def lint(path: Path) -> list[Finding]:
    config, failure = load(path)
    if failure:
        return [failure]

    out: list[Finding] = []
    section = servers(config)
    if not has_source(section, TRACKER_MARKERS):
        out.append(Finding("ERROR", "EN002", "нет сервера трекера (jira/atlassian) — срез «противоречие» аудита проверять нечем; deep продолжит, пометив источник UNAVAILABLE"))
    if not has_source(section, WIKI_MARKERS):
        out.append(Finding("ERROR", "EN003", "нет сервера вики (confluence/atlassian) — существующие ТЗ не поднимутся, а /bft-deliver будет некуда публиковать"))

    secrets = inline_secrets(section)
    for server, key in secrets:
        out.append(Finding("ERROR", "EN004", f"секрет записан значением: сервер «{server}», ключ «{key}» — заменить на ссылку ${{{key}}}, значение держать в окружении"))
    if secrets and git_ignored(path) is False:
        out.append(Finding("ERROR", "EN005", f"{path} содержит секреты значением и не закрыт от git — добавить в .gitignore до первого коммита"))

    return out


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Проверка конфига MCP перед /bft-deep")
    parser.add_argument("config", type=Path, help="файл конфига MCP (напр. .mcp.json)")
    parser.add_argument("--format", choices=["text", "json"], default="text")
    args = parser.parse_args(argv)

    findings = lint(args.config)
    if args.format == "json":
        print(json.dumps([asdict(f) for f in findings], ensure_ascii=False, indent=2))
    else:
        for f in findings:
            print(f"{args.config}: {f.level} {f.code} {f.message}")
        if not findings:
            print(f"{args.config}: OK — трекер и вики объявлены, секреты вынесены в окружение")
        else:
            print("\nФорма конфига — половина проверки. Отвечают ли серверы на самом деле, "
                  "показывает живой вызов на стадии 0а (`environment_setup.md` §1).")

    if any(f.code == "EN001" for f in findings):
        return 2
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
