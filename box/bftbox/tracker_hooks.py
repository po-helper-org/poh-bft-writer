"""Приём вебхуков Трекера (Т10, ADR-0004): коробка узнаёт о действиях людей.

Аутентификация — два пути: подпись Vikunja `X-Vikunja-Signature`
(HMAC-SHA256 от сырого тела с секретом вебхука) или прямой секрет в
`X-Secret`/`X-Hook-Token` (свои интеграции, зонды). Продолжение воркфлоу по
закрытию верификационной задачи включает Т12 (сценарные активности): там
событие станет сигналом ожиданию. Разбор и проверки — чистые функции.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
from typing import Optional

log = logging.getLogger("bftbox.tracker")

# События проектных вебхуков Vikunja (проверено живым зондированием API 2.7.1:
# task.done событием НЕ является — закрытие приходит task.updated с done=true).
TRACKED_EVENTS = {"task.updated", "task.comment.created", "task.created"}

SIGNATURE_HEADER = "x-vikunja-signature"
SECRET_HEADERS = ("x-secret", "x-hook-token")


def verify_signature(raw_body: bytes, signature: str, secret: str) -> bool:
    """Подпись Vikunja: hex(HMAC-SHA256(secret, raw_body))."""
    if not secret or not signature:
        return False
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def authorize(headers: dict, expected: str) -> bool:
    """Прямой секрет в X-Secret/X-Hook-Token (не Vikunja)."""
    if not expected:
        return False
    return any(headers.get(h, "") == expected for h in SECRET_HEADERS)


def parse_event(body: dict) -> Optional[dict]:
    """Валидное событие → {name, task_id, title, done}; мусор — None."""
    if not isinstance(body, dict):
        return None
    name = body.get("event_name")
    if name not in TRACKED_EVENTS:
        return None
    # Vikunja оборачивает нагрузку в data (живой факт 2.7.1): {event_name,
    # time, data: {task, project, doer}}; task.updated едет без тела задачи —
    # только id; description мост добирает GET /tasks/{id}.
    data = body.get("data") if isinstance(body.get("data"), dict) else body
    task = data.get("task") if isinstance(data.get("task"), dict) else {}
    task_id = task.get("id", data.get("task_id"))
    if not isinstance(task_id, int):
        return None
    return {
        "name": name,
        "task_id": task_id,
        "title": task.get("title", body.get("task_title", "")),
        "done": task.get("done", body.get("task_done")) is True,
        # Маркер bft:<инициатива>#<указание> живёт в описании — он и ведёт
        # вебхук к исходу указания (bridges.outcome_from_tracker).
        "description": task.get("description", ""),
    }


def receive(body: dict, headers: dict, expected: str, raw_body: bytes = b"") -> tuple[int, dict]:
    """Полный цикл приёма: (HTTP-статус, ответ). Роуту больше знать не нужно."""
    signature = headers.get(SIGNATURE_HEADER, "")
    if not (verify_signature(raw_body, signature, expected) or authorize(headers, expected)):
        # Имена без значений: отладка чужих интеграций без утечки секретов.
        log.info("tracker hook: 401, заголовки: %s", sorted(headers))
        return 401, {"error": "не тот секрет вебхука"}
    event = parse_event(body)
    if event is None:
        # 200: Трекер не должен ретраить то, что мы сознательно игнорируем.
        log.info("tracker hook: игнор: event=%s", body.get("event_name"))
        return 200, {"received": False}
    # Диагностика мостов: какие поля задачи реально приезжают (Т12).
    log.info("tracker hook: task fields: %s", sorted((body.get("task") or {}).keys()))
    log.info("tracker: %s task=%s done=%s «%s»", event["name"], event["task_id"], event["done"], event["title"][:80])
    return 200, {"received": True, **event}
