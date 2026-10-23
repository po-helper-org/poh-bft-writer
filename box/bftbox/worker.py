"""Воркер коробки: python -m bftbox.worker"""
from __future__ import annotations

import asyncio
import concurrent.futures
import logging

from prometheus_client import start_http_server
from temporalio.client import Client
from temporalio.worker import Worker
from temporalio.worker.workflow_sandbox import SandboxedWorkflowRunner, SandboxRestrictions

from . import config
from .activities import Activities
from .llm import OpenAIProducer
from .metrics import WORKER_REGISTRY, timed
from .store import make_store
from .workflow import InitiativeWorkflow


def build_worker(client, producer, store, queue=None) -> Worker:
    acts = Activities(producer, store)
    return Worker(client, task_queue=queue or config.TASK_QUEUE, workflows=[InitiativeWorkflow],
                  activities=[acts.produce_iteration, acts.persist],
                  activity_executor=concurrent.futures.ThreadPoolExecutor(max_workers=8),
                  workflow_runner=SandboxedWorkflowRunner(restrictions=SandboxRestrictions.default.with_passthrough_modules(
                      "bftbox", "jsonschema", "jsonschema_specifications", "referencing", "rpds", "attrs")))


async def main():
    logging.basicConfig(level=logging.INFO)
    for attempt in range(30):   # Postgres мог ещё не подняться
        try:
            store = make_store(config.DATABASE_URL)
            break
        except Exception as e:  # noqa: BLE001
            logging.warning("Postgres не готов (%s), повтор", e)
            await asyncio.sleep(2)
    start_http_server(int(config.env("METRICS_PORT", "9101")), addr=config.env("METRICS_HOST", "0.0.0.0"), registry=WORKER_REGISTRY)   # время и исходы вызовов модели
    client = await Client.connect(config.TEMPORAL_ADDRESS, namespace=config.TEMPORAL_NAMESPACE)
    await build_worker(client, timed(OpenAIProducer()), store).run()


if __name__ == "__main__":
    asyncio.run(main())
