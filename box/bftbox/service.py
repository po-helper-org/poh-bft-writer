"""Вызовы протокола поверх Temporal и хранилища: то, что отдаёт MCP-сервер и страница /bft."""
from __future__ import annotations

import asyncio
import uuid

from temporalio.client import Client, WorkflowUpdateFailedError
from temporalio.service import RPCError

from . import config
from .engine import ts
from .protocol import SCHEMA_VERSION, BoxError, body_hash, check_version, validate
from .quality import Policy
from .render import render
from .workflow import InitiativeWorkflow


class Box:
    def __init__(self, client: Client, store, policy: Policy, admins=None, queue: str | None = None):
        self.client, self.store, self.policy = client, store, policy
        self.admins, self.queue = set(admins or ()), queue or config.TASK_QUEUE

    # ---------- доступ ----------

    def _own(self, owner: str, initiative_id: str) -> dict:
        ini = self.store.initiative(initiative_id)
        if not ini:
            raise BoxError("unknown_initiative", f"инициативы {initiative_id} нет.")
        if ini["owner"] != owner and owner not in self.admins:
            raise BoxError("forbidden", "чужая инициатива.")
        return ini

    def _handle(self, initiative_id: str):
        return self.client.get_workflow_handle_for(InitiativeWorkflow.run, initiative_id)

    # ---------- вызовы ----------

    async def start(self, owner: str, req: dict) -> dict:
        check_version(req.get("schema_version"))
        validate("StartRequest", req)
        new_id = "ini-" + uuid.uuid4().hex[:8]
        h, ini_id = self.store.claim_start(owner, req["idempotency_key"], body_hash(req), new_id)
        if h != body_hash(req):
            raise BoxError("idempotency_mismatch", f"Ключ {req['idempotency_key']} уже был с другим телом.")
        if ini_id == new_id:
            await self.client.start_workflow(
                InitiativeWorkflow.run,
                {"initiative_id": ini_id, "owner": owner, "request": req,
                 "policy": {"checks": self.policy.checks, "required_sections": list(self.policy.required_sections),
                            "stuck_after": self.policy.stuck_after, "strict": self.policy.strict}},
                id=ini_id, task_queue=self.queue)
        return await self._start_ack(ini_id)

    async def _start_ack(self, initiative_id: str) -> dict:
        handle = self._handle(initiative_id)
        for _ in range(100):   # воркфлоу отвечает, как только записал первую итерацию-шапку
            ack = await handle.query(InitiativeWorkflow.get_start_ack)
            if ack:
                return ack
            await asyncio.sleep(0.1)
        raise BoxError("not_ready", "инициатива ещё создаётся.", retry_after_seconds=5)

    async def submit(self, owner: str, req: dict) -> dict:
        check_version(req.get("schema_version"))
        validate("SubmitRequest", req)
        self._own(owner, req["initiative_id"])
        return await self._update(InitiativeWorkflow.submit, req)

    async def control(self, owner: str, req: dict) -> dict:
        check_version(req.get("schema_version"))
        validate("ControlRequest", req)
        self._own(owner, req["initiative_id"])
        return await self._update(InitiativeWorkflow.control, req)

    async def _update(self, update, req: dict) -> dict:
        try:
            res = await self._handle(req["initiative_id"]).execute_update(update, req)
        except (WorkflowUpdateFailedError, RPCError) as e:
            raise BoxError("model_failed", f"Temporal недоступен: {e}"[:300], retry_after_seconds=30) from None
        if "error" in res:
            e = res["error"]["error"]
            raise BoxError(e["code"], e["message"], **{k: v for k, v in e.items() if k not in ("code", "message")})
        return res["ack"]

    # ---------- чтение (без модели и без воркфлоу) ----------

    def get(self, owner: str, iteration_id: str, fmt: str = "json"):
        it = self.store.iteration(iteration_id)
        if not it:
            raise BoxError("unknown_initiative", f"итерации {iteration_id} нет.")
        self._own(owner, it["initiative_id"])
        return render(it) if fmt == "md" else it

    def status(self, owner: str, initiative_id: str) -> dict:
        return self._own(owner, initiative_id)["status"]

    def list(self, owner: str) -> dict:
        items = [{k: i[k] for k in ("initiative_id", "goal", "state", "latest_iteration_id", "external_refs") if i.get(k) or k != "external_refs"}
                 for i in self.store.initiatives(None if owner in self.admins else owner)]
        return {"schema_version": SCHEMA_VERSION, "initiatives": items}

    # ---------- для страницы /bft ----------

    def board(self, owner: str) -> dict:
        rows = self.store.initiatives(None if owner in self.admins else owner)
        return {"schema_version": SCHEMA_VERSION, "initiatives": [self._card(r) for r in rows]}

    def _card(self, i: dict) -> dict:
        latest = self.store.iteration(i["latest_iteration_id"]) or {}
        checks = latest.get("checks") or []
        return {"initiative_id": i["initiative_id"], "goal": i["goal"], "state": i["state"], "team": i.get("team"),
                "external_refs": i.get("external_refs") or {}, "updated_at": i.get("updated_at"),
                "package_version": i.get("package_version", 0), "iteration": latest.get("number"),
                "iteration_status": latest.get("status"), "summary": latest.get("summary") or (latest.get("error") or {}).get("message"),
                "checks": {s: sum(1 for c in checks if c["status"] == s) for s in ("green", "yellow", "red")},
                "next_deadline": (i.get("status") or {}).get("next_deadline"),
                "temporal_url": f"{config.TEMPORAL_UI_URL}/namespaces/{config.TEMPORAL_NAMESPACE}/workflows/{i['initiative_id']}"}

    def card(self, owner: str, initiative_id: str) -> dict:
        i = self._own(owner, initiative_id)
        latest = self.store.iteration(i["latest_iteration_id"])
        return {**self._card(i), "latest": latest}
