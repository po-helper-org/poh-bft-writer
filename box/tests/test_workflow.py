"""Воркфлоу на настоящем Temporal (тестовый сервер): start → итерация модели → submit → сбой модели → таймер срока."""
import asyncio
import datetime as dt
import threading

import pytest
import pytest_asyncio
from temporalio.testing import WorkflowEnvironment

from bftbox.protocol import BoxError
from bftbox.quality import Policy
from bftbox.service import Box
from bftbox.store import MemoryStore
from bftbox.worker import build_worker
from tests.test_quality import BFT, good

pytestmark = pytest.mark.asyncio(loop_scope="module")


class Scripted:
    """Модель-двойник: отдаёт заготовленные ответы по очереди; Exception в очереди — сбой вызова."""

    def __init__(self, *answers):
        self.answers, self.calls, self.lock = list(answers), [], threading.Lock()

    def produce(self, ctx):
        with self.lock:
            self.calls.append(ctx)
            a = self.answers.pop(0) if self.answers else good(next_state="working")
        if isinstance(a, Exception):
            raise a
        return a


def start_req(key="k1", **kw):
    return {"schema_version": "1.0.0", "goal": "Выгрузка заказов в CSV", "brief": "Бухгалтер копирует заказы вручную",
            "team": "team-a", "external_refs": {"root_card": "t_1"}, "idempotency_key": key, **kw}


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def env():
    e = await WorkflowEnvironment.start_time_skipping()
    yield e
    await e.shutdown()


async def run_box(env, producer, queue):
    store = MemoryStore()
    worker = build_worker(env.client, producer, store, queue)
    box = Box(env.client, store, Policy.load(strict=False), {"ui"}, queue)
    return store, worker, box


async def wait_ready(box, owner, iteration_id, tries=100):
    for _ in range(tries):
        try:
            it = box.get(owner, iteration_id)
            if it["status"] != "preparing":
                return it
        except BoxError:
            pass
        await asyncio.sleep(0.05)
    raise AssertionError("итерация не подготовилась")


async def test_start_iterate_submit(env):
    producer = Scripted(good(next_state="brief", directives=[
        {"kind": "ask", "to": {"role": "po", "po_can_answer": True}, "text": "Кто сверяет заказы?", "closes": ["G07"], "expected": "fact"}]),
        good(next_state="plan_approval"))
    store, worker, box = await run_box(env, producer, "q1")
    async with worker:
        ack = await box.start("hermes", start_req())
        assert (ack["status"], ack["state"], ack["new_iteration"]) == ("preparing", "goal", True)
        # повтор с тем же ключом и телом — тот же ответ; с другим телом — idempotency_mismatch
        assert (await box.start("hermes", start_req()))["initiative_id"] == ack["initiative_id"]
        with pytest.raises(BoxError) as err:
            await box.start("hermes", start_req(goal="другое"))
        assert err.value.code == "idempotency_mismatch"
        it1 = await wait_ready(box, "hermes", ack["iteration_id"])
        assert it1["state"] == "brief" and it1["directives"][0]["id"] == "dir-001"
        assert box.status("hermes", ack["initiative_id"])["latest"]["status"] == "ready"
        # чужой исполнитель не видит инициативу, интерфейс (admin) — видит
        with pytest.raises(BoxError) as err:
            box.status("other", ack["initiative_id"])
        assert err.value.code == "forbidden"
        assert box.status("ui", ack["initiative_id"])["state"] == "brief"
        # submit исходов → итерация 2
        sub = await box.submit("hermes", {"schema_version": "1.0.0", "initiative_id": ack["initiative_id"], "base_iteration": it1["iteration_id"],
                                           "idempotency_key": "s1", "outcomes": [{"directive_id": "dir-001", "result": "answer", "by_role": "po", "content": "Главный бухгалтер"}]})
        assert sub["new_iteration"] is True
        # пока итерация готовится — not_ready; готова — виден контекст с исходом
        it2 = await wait_ready(box, "hermes", sub["iteration_id"])
        assert it2["state"] == "plan_approval" and it2["trigger"] == "all_outcomes"
        assert any(o["content"] == "Главный бухгалтер" for o in producer.calls[1]["new_outcomes"])
        assert "# Итерация 2" in box.get("hermes", it2["iteration_id"], "md")
        card = box.card("ui", ack["initiative_id"])
        assert card["temporal_url"].endswith(f"/workflows/{ack['initiative_id']}") and card["checks"]["green"] == 9


async def test_model_failure_becomes_error_iteration_and_retry_works(env):
    boom = RuntimeError("модель недоступна")
    producer = Scripted(good(next_state="brief"), boom, boom, boom, good(next_state="brief"))
    store, worker, box = await run_box(env, producer, "q2")
    async with worker:
        ack = await box.start("hermes", start_req("k2"))
        it1 = await wait_ready(box, "hermes", ack["iteration_id"])
        sub = await box.submit("hermes", {"schema_version": "1.0.0", "initiative_id": ack["initiative_id"], "base_iteration": it1["iteration_id"],
                                           "idempotency_key": "s", "outcomes": [], "iterate": True})
        await env.sleep(dt.timedelta(minutes=1))   # паузы между повторами модели проматываются, а не ждутся
        bad = await wait_ready(box, "hermes", sub["iteration_id"], tries=400)
        assert bad["status"] == "error" and bad["error"]["code"] == "model_failed" and len(producer.calls) == 4
        # повтор — submit(iterate:true) от ошибочной итерации
        again = await box.submit("hermes", {"schema_version": "1.0.0", "initiative_id": ack["initiative_id"], "base_iteration": bad["iteration_id"],
                                             "idempotency_key": "s2", "outcomes": [], "iterate": True})
        ok = await wait_ready(box, "hermes", again["iteration_id"])
        assert ok["status"] == "ready" and ok["number"] == 3


async def test_deadline_timer_starts_an_iteration_without_any_call(env):
    producer = Scripted(good(next_state="brief", directives=[
        {"kind": "ask", "to": {"role": "po", "po_can_answer": True}, "text": "Кто сверяет заказы?", "closes": ["G07"], "expected": "fact", "due_in_hours": 2}]),
        good(next_state="brief", directives=[]))
    store, worker, box = await run_box(env, producer, "q3")
    async with worker:
        ack = await box.start("hermes", start_req("k3"))
        await wait_ready(box, "hermes", ack["iteration_id"])
        # время идёт само: срок указания истекает — коробка начинает итерацию trigger=deadline
        await env.sleep(dt.timedelta(hours=3))
        for _ in range(200):
            latest = store.latest(ack["initiative_id"])
            if latest["number"] == 2 and latest["status"] == "ready":
                break
            await asyncio.sleep(0.05)
        assert latest["trigger"] == "deadline" and latest["directives"][0]["attempt"] == 2
