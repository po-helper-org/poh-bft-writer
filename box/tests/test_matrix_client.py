"""Т11: шлюз Matrix — чистая половина (псевдонимы, тексты, разбор ответов)."""
import pytest

from bftbox.matrix_client import (
    ask_text, escalation_text, parse_reply, reminder_text, room_alias, room_alias_local,
)

AGENT = "@bft-box:bft.local"


def test_псевдоним_комнаты_от_слага():
    assert room_alias("direct-faq", "bft.local") == "#bft-direct-faq:bft.local"
    assert room_alias_local("Direct FAQ v2!") == "bft-direct-faq-v2"
    assert room_alias_local("Прямые-вопросы") == "bft-прямые-вопросы"


def test_пустой_слаг_брак():
    with pytest.raises(ValueError):
        room_alias_local("???---")


def test_тексты_вопрос_напоминание_эскалация():
    assert ask_text("Подтвердите границы", "2026-10-30") == (
        "❓ Подтвердите границы\nОтветьте прямо в этом чате до 2026-10-30.")
    assert ask_text("Вопрос без дедлайна") == "❓ Вопрос без дедлайна"
    assert reminder_text("Подтвердите границы", "2026-10-30").startswith("⏰")
    assert "эскалирован" in escalation_text("direct-faq", "q")


def test_разбор_ответа_чужое_текстовое_сообщение():
    ev = {"type": "m.room.message", "sender": "@customer:bft.local",
          "content": {"msgtype": "m.text", "body": "Подтверждаю границы"}}
    assert parse_reply(ev, AGENT) == "Подтверждаю границы"


def test_не_ответ_своё_нетекстовое_пустое_чужой_тип():
    assert parse_reply({"type": "m.room.message", "sender": AGENT,
                        "content": {"msgtype": "m.text", "body": "сам спросил"}}, AGENT) is None
    assert parse_reply({"type": "m.room.message", "sender": "@c:bft.local",
                        "content": {"msgtype": "m.image", "body": "x"}}, AGENT) is None
    assert parse_reply({"type": "m.room.member", "sender": "@c:bft.local"}, AGENT) is None
    assert parse_reply({"type": "m.room.message", "sender": "@c:bft.local",
                        "content": {"msgtype": "m.text", "body": "   "}}, AGENT) is None
