"""Метрики коробки для Prometheus / OTel-коллектора → OpenObserve → Grafana (дашборд «Коробка БФТ»).

Состояние инициатив читается из Postgres в момент опроса (`StoreCollector`): воркфлоу ничего не экспортирует сам, а то, что
видно на дашборде, — ровно то, что видит страница /bft. Воркер отдельно меряет вызовы модели (`timed`) на своём порту.
Имена с префиксом bft_box_; метки — только перечислимые значения (состояния, проверки, виды), без текстов и id инициатив.
"""
from __future__ import annotations

import time

from prometheus_client import CollectorRegistry, Counter, Histogram, generate_latest
from prometheus_client.core import CounterMetricFamily, GaugeMetricFamily

WORKER_REGISTRY = CollectorRegistry()
LLM_SECONDS = Histogram("bft_box_llm_seconds", "Время вызова модели за итерацию, секунды",
                        buckets=(1, 3, 10, 30, 60, 120, 300, 600), registry=WORKER_REGISTRY)
LLM_CALLS = Counter("bft_box_llm_calls", "Вызовы модели воркером по исходу", ["outcome"], registry=WORKER_REGISTRY)


class timed:
    """Обёртка над мозгом коробки: время и исход каждого вызова модели (для воркера)."""

    def __init__(self, producer):
        self.producer = producer

    def produce(self, ctx: dict) -> dict:
        start = time.monotonic()
        try:
            out = self.producer.produce(ctx)
        except Exception:
            LLM_CALLS.labels("error").inc()
            raise
        finally:
            LLM_SECONDS.observe(time.monotonic() - start)
        LLM_CALLS.labels("ok").inc()
        return out


class StoreCollector:
    """Метрики состояния из хранилища (Postgres) — в момент опроса."""

    def __init__(self, store):
        self.store = store

    def collect(self):
        s = self.store.stats()
        g = GaugeMetricFamily("bft_box_initiatives", "Инициативы по состояниям", labels=["state"])
        for state, n in sorted(s["initiatives"].items()):
            g.add_metric([state], n)
        yield g
        w = GaugeMetricFamily("bft_box_waiting_po", "Инициативы, у которых есть неотвеченное указание к PO (вопрос, план, «Нужен PO», приёмка)")
        w.add_metric([], s["po_waiting"])
        yield w
        it = CounterMetricFamily("bft_box_iterations", "Итерации по причине начала и исходу", labels=["trigger", "status"])
        for (trigger, status), n in sorted(s["iterations"].items()):
            it.add_metric([trigger, status], n)
        yield it
        p = GaugeMetricFamily("bft_box_iterations_preparing", "Итерации, которые сейчас готовятся")
        p.add_metric([], s["preparing"])
        yield p
        o = GaugeMetricFamily("bft_box_oldest_preparing_seconds", "Возраст самой долгой готовящейся итерации, секунды (0 — таких нет)")
        o.add_metric([], s["oldest_preparing_seconds"])
        yield o
        c = GaugeMetricFamily("bft_box_checks", "Светофор последних итераций: проверки по статусам", labels=["check", "status"])
        for (check, status), n in sorted(s["checks"].items()):
            c.add_metric([check, status], n)
        yield c
        d = GaugeMetricFamily("bft_box_checks_downgraded", "Зелёные, которые код понизил до жёлтых (модель завысила)")
        d.add_metric([], s["downgraded"])
        yield d
        dr = GaugeMetricFamily("bft_box_directives", "Невыполненные указания по виду и состоянию", labels=["kind", "state"])
        for (kind, state), n in sorted(s["directives"].items()):
            dr.add_metric([kind, state], n)
        yield dr


def store_registry(store) -> CollectorRegistry:
    reg = CollectorRegistry()
    reg.register(StoreCollector(store))
    return reg


def render(registry: CollectorRegistry) -> bytes:
    return generate_latest(registry)
