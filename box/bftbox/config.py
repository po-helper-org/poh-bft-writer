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
# Мосты Т12: адрес и вход Трекера, префикс квартального проекта, демо-заказчик Matrix.
TRACKER_URL = env("TRACKER_URL", "http://tracker:3456/api/v1")
TRACKER_USER = env("TRACKER_USER", "bft-admin")
TRACKER_PASSWORD = env("TRACKER_PASSWORD")
TRACKER_PROJECT_PREFIX = env("TRACKER_PROJECT_PREFIX", "БФТ")
MATRIX_URL = env("MATRIX_URL", "http://matrix:8008")
MATRIX_SERVER_NAME = env("MATRIX_SERVER_NAME", "bft.local")
MATRIX_AGENT_USER = env("MATRIX_AGENT_USER", "bft-box")
MATRIX_AGENT_TOKEN = env("MATRIX_AGENT_TOKEN")
MATRIX_DEMO_CUSTOMER = env("MATRIX_DEMO_CUSTOMER", "customer-demo")


def tokens() -> dict:
    """BOX_TOKENS="hermes:секрет1,ui:секрет2" → {секрет: исполнитель}."""
    out = {}
    for pair in env("BOX_TOKENS").split(","):
        name, _, secret = pair.strip().partition(":")
        if name and secret:
            out[secret] = name
    return out


def service_owners() -> set:
    """BOX_SERVICE_OWNERS="agent" — служебные исполнители моста: submit в любые
    инициативы (руки Коробки, Т12), без права читать чужое."""
    return {a.strip() for a in env("BOX_SERVICE_OWNERS", "agent").split(",") if a.strip()}


def admins() -> set:
    """BOX_ADMINS="ui" — исполнители, которым открыт просмотр всех инициатив (для страницы /bft)."""
    return {a.strip() for a in env("BOX_ADMINS", "ui").split(",") if a.strip()}
