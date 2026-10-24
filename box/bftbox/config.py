"""Настройки коробки — только из окружения (.env в compose)."""
from __future__ import annotations

import os


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


TEMPORAL_ADDRESS = env("TEMPORAL_ADDRESS", "temporal:7233")
TEMPORAL_NAMESPACE = env("TEMPORAL_NAMESPACE", "default")
TASK_QUEUE = env("TASK_QUEUE", "bft-box")
DATABASE_URL = env("DATABASE_URL", "postgresql://box:box@postgres:5432/box")
LLM_BASE_URL = env("LLM_BASE_URL", "https://api.openai.com/v1")
LLM_API_KEY = env("LLM_API_KEY")
LLM_API_KEY_FILE = env("LLM_API_KEY_FILE")   # путь к файлу с ключом (600) — вместо LLM_API_KEY
LLM_JSON_MODE = env("LLM_JSON_MODE", "1") != "0"   # 0 — не слать response_format (шлюз его не знает)
LLM_MODEL = env("LLM_MODEL", "gpt-4o")
LLM_TIMEOUT = int(env("LLM_TIMEOUT", "300"))
TEMPORAL_UI_URL = env("TEMPORAL_UI_URL", "http://127.0.0.1:8233").rstrip("/")
TRACKER_HOOK_TOKEN = env("TRACKER_HOOK_TOKEN")   # секрет вебхуков Трекера (ADR-0004); пусто — приёмник выключен


def tokens() -> dict:
    """BOX_TOKENS="hermes:секрет1,ui:секрет2" → {секрет: исполнитель}."""
    out = {}
    for pair in env("BOX_TOKENS").split(","):
        name, _, secret = pair.strip().partition(":")
        if name and secret:
            out[secret] = name
    return out


def admins() -> set:
    """BOX_ADMINS="ui" — исполнители, которым открыт просмотр всех инициатив (для страницы /bft)."""
    return {a.strip() for a in env("BOX_ADMINS", "ui").split(",") if a.strip()}
