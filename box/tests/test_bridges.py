"""Т12: сценарные мосты — маршруты, нагрузки, обратные ссылки, исходы."""
import pytest

from bftbox.bridges import (
    KIND_LABEL, is_customer_addressee, matrix_room_topic, outcome_from_tracker,
    outcome_from_reply, parse_ref, plan_dispatch, ref, route, room_slug_for,
    submit_request, tracker_task,
)


def d(kind, role, person=None, state="open", did="d1", text="Что сделать", due="2026-10-30T12:00:00Z"):
    return {"id": did, "kind": kind, "to": {"role": role, "person": person},
            "text": text, "due": due, "state": state}


def test_маршрутизация_po_в_ui_executor_и_collect_в_трекер_заказчик_в_matrix():
    assert route(d("approve_plan", "po")) is None
    assert route(d("decide", "po")) is None
    assert route(d("collect", "executor")) == "tracker"
    assert route(d("ask", "addressee", person="Техлид склада")) == "tracker"
    assert route(d("ask", "addressee", person="Заказчик Pharma")) == "matrix"
    assert is_customer_addressee("заказчик X") and not is_customer_addressee("бухгалтерия")


def test_задача_трекера_несёт_маркер_и_лейбл_типа():
    t = tracker_task(d("collect", "executor", did="d7", text="Воронка за квартал"), "ini-1", "Выгрузка заказов")
    assert t["description"].startswith("bft:ini-1#d7")
    assert t["label_titles"] == [KIND_LABEL["collect"]]
    assert t["due_date"] == "2026-10-30T12:00:00Z"
    # ask-адресату — верификационная
    assert tracker_task(d("ask", "addressee"), "i", "g")["label_titles"] == ["верификационная"]


def test_обратная_ссылка_парсится_из_описания_и_темы():
    assert parse_ref("bft:ini-42#dir-9\nИнициатива: …") == ("ini-42", "dir-9")
    assert parse_ref(matrix_room_topic("ini-1", "d1", "Цель")) == ("ini-1", "d1")
    assert parse_ref("без маркера") is None


def test_исход_из_закрытой_задачи_открытая_не_исход():
    closed = {"id": 5, "done": True, "title": "Собрать воронку", "description": "bft:ini-1#d2 …"}
    o = outcome_from_tracker(closed)
    assert o == {"directive_id": "d2", "result": "answer", "by_role": "addressee",
                 "content": "Задача #5 закрыта в Трекере: Собрать воронку"}
    assert outcome_from_tracker({"id": 5, "done": False, "description": "bft:i#d"}) is None
    assert outcome_from_tracker({"id": 5, "done": True, "description": "без маркера"}) is None


def test_исход_из_ответа_и_submit_запрос():
    assert outcome_from_reply("Подтверждаю границы")["by_role"] == "addressee"
    req = submit_request("ini-1", "it-1", [outcome_from_reply("Да")], "k-1")
    assert req == {"schema_version": "1.0.0", "initiative_id": "ini-1", "base_iteration": "it-1",
                   "outcomes": [{"result": "answer", "by_role": "addressee", "content": "Да"}],
                   "idempotency_key": "k-1"}


def test_план_диспетчеризации_пропускает_po_закрытые_и_существующие():
    cards = [{
        "initiative_id": "ini-1",
        "latest": {"directives": [
            d("approve_plan", "po"),
            d("collect", "executor", did="d-collect"),
            d("ask", "addressee", person="Заказчик", did="d-ask", state="overdue"),
            d("ask", "addressee", person="Техлид", did="d-done", state="closed"),
        ]},
    }]
    plan = plan_dispatch(cards, {ref("ini-1", "d-collect")})
    assert [(x[1]["id"], x[2]) for x in plan] == [("d-ask", "matrix")]
    # существующая задача collect не дублируется, po не едет, closed не едет


def test_слаг_комнаты_из_external_refs_или_идентификатора():
    assert room_slug_for({"external_refs": {"slug": "direct-faq"}}) == "direct-faq"
    assert room_slug_for({"initiative_id": "ini-9"}) == "ini-9"
