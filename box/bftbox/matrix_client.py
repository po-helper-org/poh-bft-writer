"""Шлюз Matrix (Т11, ADR-0006): коробка пишет и слушает комнаты инициатив.

Тонкий адаптер над Client-Server API v3 на httpx (зависимость коробки уже
есть) — matrix-nio не заводим: пять вызовов не стоят новой зависимости, а
своё кольцо проще держать под контрактом. Чистая половина (псевдонимы, тексты
сообщений, разбор sync) тестируется без сети; походы — инъекция httpx-клиента.

Комната на инициативу: `#bft-<slug>:<server>` (ADR-0006). Агент коробки —
пользователь MATRIX_AGENT_USER; заказчик получает приглашение и отвечает в
комнате — слушатель отдаёт ответы как вход `submit` (завершение — Т12).
"""
from __future__ import annotations

import re
from typing import Optional

SLUG_RE = re.compile(r"[^a-z0-9а-яё-]+")


def room_alias_local(slug: str) -> str:
    """Локальная часть псевдонима: `bft-<чистый слаг>`; пусто — брак."""
    cleaned = SLUG_RE.sub("-", slug.lower().strip()).strip("-")
    if not cleaned:
        raise ValueError("пустой слаг — комнаты без слага не бывает")
    return f"bft-{cleaned}"


def room_alias(slug: str, server: str) -> str:
    return f"#{room_alias_local(slug)}:{server}"


def ask_text(question: str, deadline: str = "") -> str:
    """Вопрос верификации в комнату: одна строка, дедлайн — если задан."""
    base = f"❓ {question.strip()}"
    return f"{base}\nОтветьте прямо в этом чате до {deadline}." if deadline else base


def reminder_text(question: str, deadline: str) -> str:
    return f"⏰ Напоминаем: ждем ответ до {deadline}. {question.strip()}"


def escalation_text(slug: str, question: str) -> str:
    return (f"🚫 Ответа нет — вопрос по «{slug}» эскалирован PO. "
            f"Комната продолжает переписку, решение зафиксирует система.")


def parse_reply(event: dict, agent_user: str) -> Optional[str]:
    """Ответ заказчика из события sync: чужое текстовое сообщение в комнате.

    События агента и нетекстовые — не ответ. Пустой текст — не ответ.
    """
    if not isinstance(event, dict) or event.get("type") != "m.room.message":
        return None
    sender = event.get("sender", "")
    if not sender or sender == agent_user:
        return None
    content = event.get("content", {})
    if content.get("msgtype") != "m.text":
        return None
    body = (content.get("body") or "").strip()
    return body or None


class MatrixClient:
    """Пять вызовов коробки: комната, приглашение, сообщение, sync, whoami."""

    def __init__(self, deps: {"url": str, "token": str, "user": str, "http": "object"}):
        self.url = deps["url"].rstrip("/")
        self.token = deps["token"]
        self.user = deps["user"]
        self.http = deps["http"]  # httpx.AsyncClient-совместимый

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.token}"}

    async def whoami(self) -> dict:
        res = await self.http.get(f"{self.url}/_matrix/client/v3/account/whoami", headers=self._headers())
        return {"status": res.status_code, "user": (await res.json()).get("user_id")}

    async def create_room(self, slug: str, name: str, invite: "list[str]") -> dict:
        body = {
            "room_alias_name": room_alias_local(slug),
            "name": name or f"БФТ: {slug}",
            "topic": "Верификация требований инициативы",
            "preset": "private_chat",
            "invite": invite,
        }
        res = await self.http.post(f"{self.url}/_matrix/client/v3/createRoom",
                                   headers=self._headers(), json=body)
        data = await res.json()
        return {"status": res.status_code, "room_id": data.get("room_id"), "alias": data.get("room_alias")}

    async def invite(self, room_id: str, user_id: str) -> int:
        res = await self.http.post(f"{self.url}/_matrix/client/v3/rooms/{room_id}/invite",
                                   headers=self._headers(), json={"user_id": user_id})
        return res.status_code

    async def send_text(self, room_id: str, text: str) -> dict:
        res = await self.http.post(
            f"{self.url}/_matrix/client/v3/rooms/{room_id}/send/m.room.message",
            headers=self._headers(), json={"msgtype": "m.text", "body": text})
        data = await res.json()
        return {"status": res.status_code, "event_id": data.get("event_id")}

    async def sync(self, since: str = "", timeout_ms: int = 0) -> dict:
        params = {"timeout": str(timeout_ms)}
        if since:
            params["since"] = since
        res = await self.http.get(f"{self.url}/_matrix/client/v3/sync",
                                  headers=self._headers(), params=params)
        return await res.json()
