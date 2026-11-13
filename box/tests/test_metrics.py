"""Метрики для Grafana: состояние из хранилища и учёт вызовов модели."""
import datetime as dt

import pytest

from bftbox import metrics
from bftbox.engine import Engine, parse_ts
from bftbox.quality import Policy
from bftbox.store import MemoryStore
from tests.test_quality import NOW, good


def snapshot_into(store, engine):
    store.save(engine.snapshot())


def make(goal, key):
    e, _, w = Engine.start(Policy.load(), f"ini-{key}", {"schema_version": "1.0.0", "goal": goal, "brief": "Бухгалтер копирует заказы вручную",
                                                          "team": "team-a", "idempotency_key": key}, "po", NOW)
    return e, w


def samples(registry):
    out = {}
    for fam in registry.collect():
        for s in fam.samples:
            out[(s.name, tuple(sorted(s.labels.items())))] = s.value
    return out


def test_state_metrics_from_the_store():
    store = MemoryStore()
    a, wa = make("Выгрузка", "00000001")
    snapshot_into(store, a)                                     # итерация готовится
    b, wb = make("Отчёт", "00000002")
    p = good(next_state="brief")
    p["checks"][0]["evidence"] = "цитата «заказчик требует интеграцию с SAP» нигде не встречается"
    b.complete(wb.iteration_id, p, NOW)                          # G01 завышена — код понизит
    snapshot_into(store, b)
    body = metrics.render(metrics.store_registry(store)).decode()
    m = samples(metrics.store_registry(store))

    assert m[("bft_box_initiatives", (("state", "goal"),))] == 1 and m[("bft_box_initiatives", (("state", "brief"),))] == 1
    assert m[("bft_box_iterations_preparing", ())] == 1
    assert m[("bft_box_iterations_total", (("status", "preparing"), ("trigger", "start")))] == 1
    assert m[("bft_box_iterations_total", (("status", "ready"), ("trigger", "start")))] == 1
    assert m[("bft_box_checks", (("check", "G01"), ("status", "yellow")))] == 1     # понижена кодом
    assert m[("bft_box_checks_downgraded", ())] == 1
    assert m[("bft_box_waiting_po", ())] == 0   # у обеих инициатив в тесте указаний к PO нет
    assert "bft_box_oldest_preparing_seconds" in body
    # приватного в метриках нет: ни целей, ни id инициатив, ни текстов доказательств
    assert "Выгрузка" not in body and "ini-0000" not in body and "SAP" not in body


def test_oldest_preparing_age_grows_for_a_stuck_iteration():
    store = MemoryStore()
    e, w = make("Выгрузка", "00000003")
    snapshot_into(store, e)
    later = NOW + dt.timedelta(minutes=20)
    assert store.stats(later)["oldest_preparing_seconds"] == pytest.approx(1200, abs=1)


def test_llm_calls_are_timed_and_counted_by_outcome():
    class Ok:
        def produce(self, ctx):
            return {"ok": 1}

    class Boom:
        def produce(self, ctx):
            raise RuntimeError("недоступна")

    before = samples(metrics.WORKER_REGISTRY)
    metrics.timed(Ok()).produce({})
    with pytest.raises(RuntimeError):
        metrics.timed(Boom()).produce({})
    after = samples(metrics.WORKER_REGISTRY)
    ok, err = ("bft_box_llm_calls_total", (("outcome", "ok"),)), ("bft_box_llm_calls_total", (("outcome", "error"),))
    assert after[ok] - before.get(ok, 0) == 1 and after[err] - before.get(err, 0) == 1
    assert after[("bft_box_llm_seconds_count", ())] - before.get(("bft_box_llm_seconds_count", ()), 0) == 2


def test_accepted_and_cancelled_initiatives_do_not_hold_open_directives():
    store = MemoryStore()
    e, w = make("Выгрузка", "00000004")
    e.complete(w.iteration_id, good(next_state="brief", directives=[
        {"kind": "ask", "to": {"role": "po", "po_can_answer": True}, "text": "Кто сверяет заказы?", "closes": ["G07"], "expected": "fact"}]), NOW)
    snapshot_into(store, e)
    assert store.stats()["directives"][("ask", "open")] == 1
    e.state = "accepted"
    snapshot_into(store, e)
    assert not store.stats()["directives"]


def test_waiting_po_counts_initiatives_with_an_unanswered_directive_to_po():
    store = MemoryStore()
    for key, role in (("00000005", "po"), ("00000006", "addressee")):
        e, w = make("Выгрузка " + key, key)
        e.plan = {"approved": True, "addressees": ["Главный бухгалтер"]}
        e.state = "working"
        e.complete(w.iteration_id, good(next_state="working", directives=[
            {"kind": "ask", "to": {"role": role, "person": "Главный бухгалтер", "po_can_answer": False}, "text": "Какие поля нужны?",
             "closes": ["G07"], "expected": "fact"}]), NOW)
        snapshot_into(store, e)
    assert store.stats()["po_waiting"] == 1   # вопрос адресату PO не ждёт
