"""Т10: приём вебхуков Трекера — секрет, разбор событий, ответы приёмника."""
import hashlib
import hmac
import json
import pytest

from bftbox.tracker_hooks import authorize, parse_event, receive, TRACKED_EVENTS

BODY = {
    "event_name": "task.updated",
    "task": {"id": 42, "title": "Подтвердить границы с заказчиком", "done": True},
    "project": {"id": 7},
}


def test_секрет_проверяется_в_обоих_заголовках():
    assert authorize({"x-secret": "s"}, "s")
    assert authorize({"x-hook-token": "s"}, "s")
    assert not authorize({"x-secret": "s"}, "y")
    assert not authorize({}, "")


def test_разбор_валидного_события():
    e = parse_event(BODY)
    assert e == {"name": "task.updated", "task_id": 42, "title": "Подтвердить границы с заказчиком", "done": True}


@pytest.mark.parametrize("body", [
    None, "строка", {}, {"event_name": "user.login", "task": {"id": 1}},
    {"event_name": "task.done"}, {"event_name": "task.done", "task": {"id": "не-число"}},
])
def test_мусор_игнорируется_молча(body):
    assert parse_event(body) is None


def test_приём_полный_цикл():
    assert receive(BODY, {"x-secret": "s"}, "s") == (200, {
        "received": True, "name": "task.updated", "task_id": 42,
        "title": "Подтвердить границы с заказчиком", "done": True,
    })
    # 401 без секрета, 200-молчание на мусор (без ретраев Трекера), 200-молчание на чужое событие
    assert receive(BODY, {"x-secret": "wrong"}, "s")[0] == 401
    assert receive({"event_name": "project.created"}, {"x-secret": "s"}, "s") == (200, {"received": False})
    assert receive({"junk": True}, {"x-secret": "s"}, "s") == (200, {"received": False})


def test_отслеживаемые_события_покрывают_диалоги():
    # task.done событием не является (проверено на живом 2.7.1): закрытие
    # приходит task.updated с done=true — его и ловим.
    assert {"task.updated", "task.comment.created", "task.created"} == TRACKED_EVENTS


def test_подпись_vikunja_hmac_проверяется_по_сырому_телу():
    import hashlib, hmac as h
    raw = json.dumps(BODY).encode()
    sig = h.new(b"s", raw, hashlib.sha256).hexdigest()
    # подпись валидна, прямой секрет не нужен
    assert receive(BODY, {"x-vikunja-signature": sig}, "s", raw)[0] == 200
    assert receive(BODY, {"x-vikunja-signature": sig}, "s", "другое тело".encode())[0] == 401
    assert receive(BODY, {"x-vikunja-signature": "0" * 64}, "s", raw)[0] == 401
    # тело изменилось после подписи (json-переупаковка) — подпись не сойдётся:
    # поэтому роут передаёт raw, а не пере-сериализует
