"""Сценарные мосты (Т12, ADR-0003/0004/0006): указания Коробки — в работу, ответы — обратно.

Маршрутизация по типу исполнителя, не по настройке человека:
  po              → карточки в UI (Т13), мостов не нужно;
  executor/collect→ задача в Трекере (сборочная, верификационная — по kind);
  ask·addressee   → сотрудник — задача в Трекере; заказчик (по подписи person)
                    — комната Matrix с вопросом (ADR-0006).

Обратная дорога: задача закрыта (task.updated done) или ответ в комнате —
Outcome контракта 1.0.0, Коробка принимает `submit` от исполнителя `agent`
(мосты — руки Коробки, ADR-0003 rev 2: агенты не знают про Коробку, но мосты
— её собственные активности, не агентные сессии).

Чистая половина: маршруты, полезные нагрузки, разбор обратных ссылок.
Идёмпотентность — маркером `bft:<инициатива>#<указание>` в описании задачи
и теме комнаты: повторная диспетчеризация видит существующее и не плодит.
"""
from __future__ import annotations

import re
from typing import Optional

from .matrix_client import ask_text, room_alias_local

# Исполнитель моста в BOX_TOKENS (start.sh: ...,agent:...).
BRIDGE_OWNER = "agent"

REF_RE = re.compile(r"bft:([A-Za-z0-9_-]+)#([A-Za-z0-9_-]+)")

# Лейблы Трекера по kind указания (сид: сборочная/верификационная/…).
KIND_LABEL = {
    "collect": "сборочная",
    "ask": "верификационная",
    "clarify_team": "верификационная",
}


def ref(initiative_id: str, directive_id: str) -> str:
    return f"bft:{initiative_id}#{directive_id}"


def parse_ref(text: str) -> Optional[tuple[str, str]]:
    """Обратная ссылка из описания задачи/темы комнаты; нет — None."""
    m = REF_RE.search(text or "")
    return (m.group(1), m.group(2)) if m else None


def is_customer_addressee(person: Optional[str]) -> bool:
    """Заказчик ли адресат: Коробка различает только po/addressee/executor,
    подпись person называет роль в организации (контракт 1.0.0, to.person)."""
    return bool(re.search(r"заказчик|клиент|customer", (person or "").lower()))


def route(directive: dict) -> Optional[str]:
    """Куда отправить указание: tracker | matrix | None (UI/PO — Т13).

    Решения PO (approve_plan/decide/…) — только люди в UI; executor —
    сборочные руки; ask адресату — сотрудник или заказчик.
    """
    kind = directive.get("kind", "")
    role = (directive.get("to") or {}).get("role", "")
    if role == "po":
        return None
    if role == "executor" or kind == "collect":
        return "tracker"
    if kind == "ask":
        return "matrix" if is_customer_addressee((directive.get("to") or {}).get("person")) else "tracker"
    return None


def tracker_task(directive: dict, initiative_id: str, goal: str) -> dict:
    """Полезная нагрузка задачи Vikunja: маркер в описании — ключ идемпотентности."""
    label = KIND_LABEL.get(directive["kind"], "сессионная")
    return {
        "title": (directive.get("text") or directive["kind"]).strip()[:250],
        "description": f"{ref(initiative_id, directive['id'])}\nИнициатива: {goal[:180]}",
        "label_titles": [label],
        "due_date": directive.get("due"),
    }


def matrix_room_topic(initiative_id: str, directive_id: str, goal: str) -> str:
    return f"{ref(initiative_id, directive_id)} — {goal[:160]}"


def matrix_question(directive: dict) -> str:
    return ask_text(directive.get("text") or "Вопрос верификации", directive.get("due", ""))


def outcome_from_tracker(task: dict) -> Optional[dict]:
    """Закрытая задача → Outcome. Открытая — None: не событие."""
    if not task.get("done"):
        return None
    r = parse_ref(task.get("description", ""))
    if not r:
        return None
    return {
        "directive_id": r[1],
        "result": "answer",
        "by_role": "addressee",
        "content": f"Задача #{task.get('id')} закрыта в Трекере: {(task.get('title') or '')[:120]}",
    }


def outcome_from_reply(text: str) -> dict:
    """Ответ в комнате → Outcome (комната уже своя: маркер знаем из темы)."""
    return {"result": "answer", "by_role": "addressee", "content": text[:2000]}


def submit_request(initiative_id: str, base_iteration: str, outcomes: list[dict], idem: str) -> dict:
    """SubmitRequest контракта 1.0.0 от мостов."""
    return {
        "schema_version": "1.0.0",
        "initiative_id": initiative_id,
        "base_iteration": base_iteration,
        "outcomes": outcomes,
        "idempotency_key": idem,
    }


def room_slug_for(initiative: dict) -> Optional[str]:
    """Слаг комнаты: из external_refs (интейк кладёт slug) или идентификатора."""
    ext = (initiative.get("external_refs") or {})
    slug = ext.get("slug")
    if slug:
        return slug
    return initiative.get("initiative_id")


def plan_dispatch(cards: list[dict], existing_refs: set[str]) -> list[tuple[dict, dict, str]]:
    """Что диспетчеризовать: (карточка, указание, маршрут) без уже существующих.

    Чистая функция над `/api/board`: открытые указания последней итерации,
    маршрут не None, маркер ещё не в existing_refs (задачи/комнаты).
    """
    out: list[tuple[dict, dict, str]] = []
    for card in cards:
        # Борд несёт открытые указания напрямую (Т12); fallback на полную
        # карточку — для тестов и старых ответов.
        directives = card.get("open_directives")
        if directives is None:
            directives = [d for d in (card.get("latest") or {}).get("directives") or []
                          if d.get("state") in ("open", "overdue")]
        for d in directives:
            r = route(d)
            if not r:
                continue
            if ref(card["initiative_id"], d["id"]) in existing_refs:
                continue
            out.append((card, d, r))
    return out
