"""build_env.py: из конфигурации MCP-клиента — только Jira/Confluence, без вывода значений."""

from __future__ import annotations

import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import build_env  # noqa: E402

CONFIG = """
model: some-model
mcp_servers:
  shell-everything:
    command: agent-gateway
    env:
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
  atlassian:
    command: uvx
    args:
      - mcp-atlassian
      - --jira-url
      - https://jira.example.org
      - --confluence-url=https://wiki.example.org
      - --no-confluence-ssl-verify
    env:
      JIRA_PERSONAL_TOKEN: ${JIRA_PAT}
      CONFLUENCE_PERSONAL_TOKEN: "$CONF_PAT"
      UNRELATED_SECRET: should-not-be-copied
"""
DOTENV = """
# секреты
export JIRA_PAT=jira-pat-value
CONF_PAT='conf pat "value"'
ANTHROPIC_API_KEY=nope
"""


def _write(tmp: Path) -> Path:
    cfg = tmp / "cfg" / "config.yaml"
    cfg.parent.mkdir()
    cfg.write_text(CONFIG)
    (cfg.parent / ".env").write_text(DOTENV)
    return cfg


def test_extract_takes_only_atlassian_keys(tmp_path):
    values = build_env.extract(_write(tmp_path), "atlassian")
    assert values == {
        "JIRA_URL": "https://jira.example.org",
        "CONFLUENCE_URL": "https://wiki.example.org",
        "CONFLUENCE_SSL_VERIFY": "false",
        "JIRA_PERSONAL_TOKEN": "jira-pat-value",
        "CONFLUENCE_PERSONAL_TOKEN": 'conf pat "value"',
    }


def test_cli_writes_600_file_and_prints_no_values(tmp_path):
    cfg = _write(tmp_path)
    out = tmp_path / "conf" / "env"
    r = subprocess.run(
        [sys.executable, str(HERE.parent / "build_env.py"), str(cfg), "atlassian", str(out)],
        capture_output=True, text=True, env={**os.environ, "BFT_GW_PORT": "3099"},
    )
    assert r.returncode == 0, r.stderr
    printed = r.stdout + r.stderr
    for secret in ("jira-pat-value", "conf pat", "jira.example.org"):
        assert secret not in printed
    assert stat.S_IMODE(out.stat().st_mode) == 0o600
    text = out.read_text()
    assert 'CONFLUENCE_PERSONAL_TOKEN="conf pat \\"value\\""' in text
    assert "JIRA_PERSONAL_TOKEN=jira-pat-value" in text
    assert "BFT_GW_PORT=3099" in text
    assert "ANTHROPIC_API_KEY" not in text and "UNRELATED_SECRET" not in text


@pytest.mark.parametrize("server", ["missing", "shell-everything"])
def test_errors_without_values(tmp_path, server):
    cfg = _write(tmp_path)
    r = subprocess.run(
        [sys.executable, str(HERE.parent / "build_env.py"), str(cfg), server, str(tmp_path / "env")],
        capture_output=True, text=True,
    )
    assert r.returncode == 1
    assert "nope" not in r.stdout + r.stderr
    assert not (tmp_path / "env").exists()


def test_unresolved_variable_is_error(tmp_path):
    cfg = _write(tmp_path)
    (cfg.parent / ".env").write_text("CONF_PAT=x\n")
    with pytest.raises(build_env.ConfigError, match="JIRA_PAT"):
        build_env.extract(cfg, "atlassian")
