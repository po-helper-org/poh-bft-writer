"""Активности воркера: вызов модели и запись состояния для чтения."""
from __future__ import annotations

from temporalio import activity


class Activities:
    def __init__(self, producer, store):
        self.producer, self.store = producer, store

    @activity.defn(name="produce_iteration")
    def produce_iteration(self, ctx: dict) -> dict:
        return self.producer.produce(ctx)

    @activity.defn(name="persist")
    def persist(self, snapshot: dict) -> None:
        self.store.save(snapshot)
