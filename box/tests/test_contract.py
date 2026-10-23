"""Движок против эталонов контракта 1.0.0: 28 сообщений проходят схему, а ответы коробки на вызовы эталонного
сценария («выгрузка заказов в CSV») совпадают с эталонными. Модель подменена записанными итерациями."""
import datetime as dt
import json
import os
import re

import pytest

from bftbox import protocol
from bftbox.engine import Engine, parse_ts, ts
from bftbox.protocol import BoxError
from bftbox.quality import Policy

CASES = os.path.join(os.path.dirname(__file__), "contract", "cases")


def case(n: int) -> dict:
    name = next(f for f in os.listdir(CASES) if f.startswith(f"{n:02d}-"))
    with open(os.path.join(CASES, name), encoding="utf-8") as f:
        return json.load(f)


def norm(obj):
    """Идентификаторы итераций движка (it-<инициатива>-<номер>) → it-<номер> эталонов."""
    return json.loads(re.sub(r"it-0001-(\d{4})", r"it-\1", json.dumps(obj, ensure_ascii=False)))


def produced_from(it: dict) -> dict:
    """Итерация-эталон → то, что вернула бы модель (порядок и сроки сохраняются)."""
    created = parse_ts(it["created_at"])
    dirs = []
    for d in it.get("directives", []):
        dirs.append({"kind": d["kind"], "to": d["to"], "group": d.get("group"), "text": d["text"], "closes": d["closes"],
                     "blocks": d.get("blocks"), "expected": d["expected"],
                     "due_in_hours": round((parse_ts(d["due"]) - created).total_seconds() / 3600)})
    return {"summary": it["summary"], "next_state": it["state"], "documents": it["package"]["documents"],
            "checks": it["checks"], "directives": dirs,
            "plan": {"addressees": ["Руководитель группы расчётов", "Главный бухгалтер", "Аналитик данных"]}}


def at(n: int) -> dt.datetime:
    """Момент вызова: у итераций-эталонов — их created_at, у остальных сообщений — тот же день, позже."""
    return parse_ts(case(n).get("created_at", "2026-10-20T10:00:00Z"))


@pytest.fixture
def policy():
    return Policy.load(strict=False)   # документы эталонов — заглушки; строгие проверки — в test_quality.py


def test_all_28_cases_pass_the_schema():
    with open(os.path.join(CASES, "cases.json"), encoding="utf-8") as f:
        index = json.load(f)
    assert len(index) == 28
    for entry in index:
        with open(os.path.join(CASES, entry["file"]), encoding="utf-8") as f:
            protocol.validate(entry["def"], json.load(f))


def test_reference_scenario(policy):
    # start → итерация 1 готовится
    e, ack, work = Engine.start(policy, "ini-0001", case(1), "po", at(3))
    assert norm(ack) == case(2)
    assert norm(e.get(work.iteration_id)) == case(3)
    # submit, пока итерация готовится → not_ready (эталон 25)
    with pytest.raises(BoxError) as err:
        e.submit({**case(5), "base_iteration": work.iteration_id}, at(3))
    assert err.value.payload()["error"]["code"] == "not_ready"
    # итерация 1 «Бриф»
    it1 = e.complete(work.iteration_id, produced_from(case(4)), at(4))
    protocol.validate("Iteration", norm(it1))
    assert norm(it1) == case(4)
    # submit брифа → итерация 2
    ack, work = e.submit({**case(5), "base_iteration": it1["iteration_id"]}, at(6))
    assert (ack["new_iteration"], ack["state"], ack["status"]) == (True, "brief", "preparing")
    it2 = e.complete(work.iteration_id, produced_from(case(6)), at(6))
    assert (it2["state"], it2["trigger"], [d["kind"] for d in it2["directives"]]) == ("plan_approval", "all_outcomes", ["approve_plan"])
    assert e.team == "team-a"
    # PO утвердил план → итерация 3: группа вопросов адресату из плана
    ack, work = e.submit({**case(7), "base_iteration": it2["iteration_id"]}, at(8))
    assert e.plan["approved"] and "Руководитель группы расчётов" in e.plan["addressees"]
    it3 = e.complete(work.iteration_id, produced_from(case(8)), at(8))
    protocol.validate("Iteration", norm(it3))
    assert [d["to"]["role"] for d in it3["directives"]].count("addressee") >= 1
    # исходы всех видов → итерация 4: адресат вне плана превращается в approve_plan_change
    ack, work = e.submit({**case(9), "base_iteration": it3["iteration_id"]}, at(10))
    assert ack["new_iteration"] is True
    it4 = e.complete(work.iteration_id, produced_from(case(10)), at(10))
    protocol.validate("Iteration", norm(it4))
    # ошибка модели — итерация N+1 со статусом error, указания прошлой итерации в силе
    ack, work = e.submit({"schema_version": "1.0.0", "initiative_id": "ini-0001", "base_iteration": it4["iteration_id"],
                          "idempotency_key": "k-iter", "outcomes": [], "iterate": True}, at(13))
    assert ack["new_iteration"] is True
    err_it = e.complete(work.iteration_id, None, at(13), error="timeout")
    protocol.validate("Iteration", norm(err_it))
    assert (err_it["status"], err_it["state"], err_it["error"]["code"]) == ("error", "needs_po", "model_failed")
    assert set(e.directives) == {d["id"] for d in it4["directives"]}


def test_pause_resume_cancel_and_errors(policy):
    e, _, work = Engine.start(policy, "ini-0001", case(1), "po", at(3))
    it1 = e.complete(work.iteration_id, produced_from(case(4)), at(4))
    # pause: ответ — последняя итерация, состояние paused, указания suspended
    ack, w = e.control({**case(15), "idempotency_key": "p1"}, at(15))
    assert w is None and (ack["state"], ack["new_iteration"], ack["status"]) == ("paused", False, "ready")
    assert all(d["state"] == "suspended" for d in e.get(it1["iteration_id"])["directives"])
    # на паузе срок не запускает итерацию
    assert e.deadline_tick(at(4) + dt.timedelta(days=30)) is None
    # resume вне паузы — invalid_state с текстом эталона 28
    ack, _ = e.control({"schema_version": "1.0.0", "initiative_id": "ini-0001", "action": "resume", "idempotency_key": "r1"}, at(16))
    assert ack["state"] == "brief"
    with pytest.raises(BoxError) as err:
        e.control({"schema_version": "1.0.0", "initiative_id": "ini-0001", "action": "resume", "idempotency_key": "r2"}, at(16))
    assert err.value.payload() == case(28)
    # cancel
    ack, _ = e.control({"schema_version": "1.0.0", "initiative_id": "ini-0001", "action": "cancel", "idempotency_key": "c1"}, at(18))
    assert ack["state"] == "cancelled"
    # повтор с тем же ключом — тот же ответ; с другим телом — idempotency_mismatch (эталон 26)
    again, _ = e.control({"schema_version": "1.0.0", "initiative_id": "ini-0001", "action": "cancel", "idempotency_key": "c1"}, at(18))
    assert again == ack
    with pytest.raises(BoxError) as err:
        e.control({"schema_version": "1.0.0", "initiative_id": "ini-0001", "action": "pause", "idempotency_key": "c1"}, at(18))
    assert err.value.payload()["error"]["code"] == "idempotency_mismatch"


def test_conflict_accumulation_and_bad_version(policy):
    e, _, work = Engine.start(policy, "ini-0001", case(1), "po", at(3))
    it1 = e.complete(work.iteration_id, produced_from(case(4)), at(4))
    one = {"schema_version": "1.0.0", "initiative_id": "ini-0001", "base_iteration": it1["iteration_id"],
           "idempotency_key": "a", "outcomes": [{"directive_id": "dir-001", "result": "answer", "by_role": "po", "content": "team-a"}]}
    # исходы по части указаний копятся, новой итерации нет (эталон 23)
    ack, w = e.submit(one, at(5))
    assert w is None and (ack["new_iteration"], ack["pending_outcomes"], ack["iteration_id"]) == (False, 2, it1["iteration_id"])
    # устаревшая base_iteration — conflict (эталон 24)
    with pytest.raises(BoxError) as err:
        e.submit({**one, "idempotency_key": "b", "base_iteration": "it-0001-0000"}, at(5))
    assert err.value.payload()["error"]["code"] == "conflict"
    assert err.value.payload()["error"]["latest_iteration_id"] == it1["iteration_id"]
    # другая мажорная версия (эталон 27)
    with pytest.raises(BoxError) as err:
        e.submit({**one, "idempotency_key": "c", "schema_version": "2.0.0"}, at(5))
    assert err.value.payload() == case(27)
    # решение PO принимается только с by_role=po
    bad = {**one, "idempotency_key": "d", "outcomes": [{"directive_id": "dir-001", "result": "answer", "by_role": "executor", "content": "x"}]}
    with pytest.raises(BoxError) as err:
        e.submit(bad, at(5))
    assert err.value.code == "validation"


def test_deadline_reissues_with_attempt_and_accept_reopen(policy):
    e, _, work = Engine.start(policy, "ini-0001", case(1), "po", at(3))
    it1 = e.complete(work.iteration_id, produced_from(case(4)), at(4))
    assert e.next_deadline() == "2026-10-21T09:00:00Z"
    w = e.deadline_tick(parse_ts("2026-10-21T09:00:01Z"))
    assert w and w.trigger == "deadline"
    it2 = e.complete(w.iteration_id, produced_from(case(4)) | {"directives": []}, parse_ts("2026-10-21T09:00:01Z"))
    assert {d["id"]: d.get("attempt") for d in it2["directives"]} == {"dir-001": 2, "dir-002": 2, "dir-003": 2}
    # принятый пакет открывается заново: тот же id инициативы, версия пакета +1
    e.state, e.directives, e.version = "accepted", {}, 3
    ack, w = e.control(case(19), at(19))
    assert (ack["new_iteration"], ack["state"]) == (True, "working")
    it = e.complete(w.iteration_id, produced_from(case(20)), at(20))
    assert it["trigger"] == "control" and it["package"]["version"] == 4
