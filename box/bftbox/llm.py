"""Мозг коробки: любой OpenAI-совместимый API (GLM, корпоративная модель, OpenAI). Ответ — JSON итерации."""
from __future__ import annotations

import json
import os
import re

import httpx

from . import config


def load_prompt() -> str:
    d = os.environ.get("PROMPTS_DIR") or os.path.join(os.path.dirname(__file__), "..", "prompts")
    with open(os.path.join(d, "system.md"), encoding="utf-8") as f:
        return f.read()


def parse_json(text: str) -> dict:
    """Ответ модели → объект: терпим ограждения ```json и пояснения вокруг."""
    t = (text or "").strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    try:
        data = json.loads(t)
    except ValueError:
        a, b = t.find("{"), t.rfind("}")
        if a < 0 or b <= a:
            raise ValueError("в ответе модели нет JSON") from None
        data = json.loads(t[a:b + 1])
    if not isinstance(data, dict):
        raise ValueError("ответ модели — не объект")
    return data


class OpenAIProducer:
    def __init__(self, base_url: str = "", api_key: str = "", model: str = "", timeout: int = 0):
        self.base_url = (base_url or config.LLM_BASE_URL).rstrip("/")
        self.api_key, self.model = api_key or config.LLM_API_KEY, model or config.LLM_MODEL
        self.key_file = os.path.expanduser(config.LLM_API_KEY_FILE) if config.LLM_API_KEY_FILE else ""
        self.timeout = timeout or config.LLM_TIMEOUT
        self.system = load_prompt()

    def _key(self) -> str:
        """Ключ из LLM_API_KEY или из файла LLM_API_KEY_FILE (читается на каждый вызов: ключ меняют без рестарта)."""
        if self.key_file:
            try:
                with open(self.key_file) as f:
                    key = f.read().strip()
            except OSError as e:
                raise RuntimeError(f"нет файла ключа модели {self.key_file}") from e
            if key:
                return key
        if not self.api_key:
            raise RuntimeError("LLM_API_KEY не задан")
        return self.api_key

    def produce(self, ctx: dict) -> dict:
        key = self._key()
        body = {"model": self.model, "temperature": 0.2,
                "messages": [{"role": "system", "content": self.system},
                             {"role": "user", "content": "Контекст инициативы (JSON):\n" + json.dumps(ctx, ensure_ascii=False)}]}
        if config.LLM_JSON_MODE:
            body["response_format"] = {"type": "json_object"}
        r = httpx.post(f"{self.base_url}/chat/completions", json=body, timeout=self.timeout,
                       headers={"Authorization": f"Bearer {key}"})
        r.raise_for_status()
        return parse_json(r.json()["choices"][0]["message"]["content"])
