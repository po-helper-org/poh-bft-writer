"""Воркфлоу Temporal «одна инициатива = один воркфлоу» (ADR 0002): итерации, таймеры сроков указаний и повторы
вызовов модели переживают рестарт. Логика — в `engine.Engine` (чистая и детерминированная); здесь только её
оркестрация: исходы приходят апдейтами, сроки — таймером, модель и запись в Postgres — активностями."""
from __future__ import annotations

import asyncio
from datetime import timedelta

from temporalio import activity, workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError

with workflow.unsafe.imports_passed_through():
    from .engine import Engine, parse_ts
    from .protocol import BoxError
    from .quality import Policy

MODEL_ATTEMPTS = 3


@workflow.defn
class InitiativeWorkflow:
    def __init__(self):
        self.engine: Engine | None = None
        self.work: list = []
        self.dirty = False
        self.start_ack: dict | None = None
        self.draining = False

    @workflow.run
    async def run(self, start: dict) -> None:
        policy = Policy(start["policy"]["checks"], tuple(start["policy"]["required_sections"]),
                        start["policy"]["stuck_after"], start["policy"].get("strict", True))
        self.engine, ack, work = Engine.start(policy, start["initiative_id"], start["request"], start["owner"], workflow.now())
        self.work.append(work)
        await self._persist()
        self.start_ack = ack
        while True:
            await self._drain()
            nd = self.engine.next_deadline()
            timeout = max((parse_ts(nd) - workflow.now()).total_seconds(), 0) if nd else None
            try:
                await workflow.wait_condition(lambda: bool(self.work) or self.dirty, timeout=timeout)
            except asyncio.TimeoutError:
                w = self.engine.deadline_tick(workflow.now())
                if w:
                    self.work.append(w)
                    self.dirty = True

    async def _drain(self):
        while self.work or self.dirty:
            if self.work:
                w = self.work.pop(0)
                ctx = self.engine.context(w.iteration_id, workflow.now())
                try:
                    produced = await workflow.execute_activity(
                        "produce_iteration", ctx, start_to_close_timeout=timedelta(minutes=10),
                        retry_policy=RetryPolicy(maximum_attempts=MODEL_ATTEMPTS, initial_interval=timedelta(seconds=5),
                                                 backoff_coefficient=3.0))
                    self.engine.complete(w.iteration_id, produced, workflow.now())
                except ActivityError as e:
                    self.engine.complete(w.iteration_id, None, workflow.now(), error=str(e.cause or e))
                self.dirty = True
            if self.dirty:
                self.dirty = False
                await self._persist()

    async def _persist(self):
        await workflow.execute_activity("persist", self.engine.snapshot(), start_to_close_timeout=timedelta(seconds=60),
                                        retry_policy=RetryPolicy(maximum_attempts=0, initial_interval=timedelta(seconds=2),
                                                                 maximum_interval=timedelta(seconds=30)))

    @workflow.query
    def get_start_ack(self) -> dict | None:
        return self.start_ack

    @workflow.update
    async def submit(self, req: dict) -> dict:
        return await self._call(self.engine.submit, req)

    @workflow.update
    async def control(self, req: dict) -> dict:
        return await self._call(self.engine.control, req)

    async def _call(self, fn, req: dict) -> dict:
        await workflow.wait_condition(lambda: self.engine is not None and self.start_ack is not None)
        try:
            ack, work = fn(req, workflow.now())
        except BoxError as e:
            return {"error": e.payload()}
        if work:
            self.work.append(work)
        await self._persist()   # читателям — до ответа апдейта, чтобы get после ack видел итерацию-шапку
        return {"ack": ack}
