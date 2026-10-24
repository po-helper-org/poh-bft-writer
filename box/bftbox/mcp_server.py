"""MCP-сервер коробки (streamable HTTP) и JSON-API для страницы /bft: python -m bftbox.mcp_server

Вызовы протокола — инструменты start / submit / get / status / control / list. Исполнитель опознаётся по
Bearer-токену из BOX_TOKENS: пишет только тот, кто начал инициативу. Отказ — сообщение Error как результат
инструмента (контракт 1.0.0), а не исключение."""
from __future__ import annotations

import json

import logging

from fastmcp import FastMCP
from fastmcp.server.auth import StaticTokenVerifier
from fastmcp.server.dependencies import get_access_token
from starlette.requests import Request
from starlette.responses import JSONResponse

from . import config
from .protocol import SCHEMA_VERSION, BoxError
from .quality import Policy
from .store import make_store

log = logging.getLogger("bftbox")
_box = None


async def box():
    global _box
    if _box is None:
        from temporalio.client import Client
        from .service import Box
        store = make_store(config.DATABASE_URL)
        client = await Client.connect(config.TEMPORAL_ADDRESS, namespace=config.TEMPORAL_NAMESPACE)
        _box = Box(client, store, Policy.load(), config.admins())
    return _box


def who() -> str:
    token = get_access_token()
    return token.client_id if token else ""


async def call(fn):
    try:
        return await fn()
    except BoxError as e:
        return e.payload()
    except Exception:  # noqa: BLE001
        log.exception("сбой вызова")
        return BoxError("model_failed", "внутренний сбой коробки", retry_after_seconds=30).payload()


def build_app() -> FastMCP:
    tokens = {secret: {"client_id": name, "scopes": []} for secret, name in config.tokens().items()}
    mcp = FastMCP("poh-bft-box", auth=StaticTokenVerifier(tokens=tokens) if tokens else None)

    @mcp.tool
    async def start(request: dict) -> dict:
        """Начать инициативу БФТ. request — StartRequest: schema_version, goal, idempotency_key; brief, files, team, external_refs."""
        return await call(lambda: _start(request))

    @mcp.tool
    async def submit(request: dict) -> dict:
        """Отдать исходы указаний. request — SubmitRequest: initiative_id, base_iteration, outcomes, idempotency_key; inputs, files, iterate."""
        return await call(lambda: _submit(request))

    @mcp.tool
    async def control(request: dict) -> dict:
        """Решение PO вне итерации. request — ControlRequest: initiative_id, action (pause|resume|cancel|reopen), idempotency_key."""
        return await call(lambda: _control(request))

    @mcp.tool
    async def get(iteration_id: str, format: str = "json"):
        """Файл итерации (Iteration) — json или markdown для PO."""
        return await call(lambda: _get(iteration_id, format))

    @mcp.tool
    async def status(initiative_id: str) -> dict:
        """Состояние инициативы и ближайший срок — дёшево, без модели."""
        return await call(lambda: _status(initiative_id))

    @mcp.tool
    async def list() -> dict:
        """Инициативы этого исполнителя."""
        return await call(_list)

    async def _start(r): return await (await box()).start(who(), r)
    async def _submit(r): return await (await box()).submit(who(), r)
    async def _control(r): return await (await box()).control(who(), r)
    async def _get(i, f): return (await box()).get(who(), i, f)
    async def _status(i): return (await box()).status(who(), i)
    async def _list(): return (await box()).list(who())

    # ---------- JSON-API страницы /bft (тот же Bearer) ----------

    def caller(request: Request) -> str:
        secret = (request.headers.get("authorization") or "").removeprefix("Bearer ").strip()
        return config.tokens().get(secret, "")

    async def api(request: Request, fn):
        who_ = caller(request)
        if not who_:
            return JSONResponse({"schema_version": SCHEMA_VERSION, "error": {"code": "forbidden", "message": "нужен токен"}}, status_code=401)
        try:
            return JSONResponse(await fn(who_, await box()))
        except BoxError as e:
            status = {"forbidden": 403, "unknown_initiative": 404, "validation": 400, "bad_schema_version": 400}.get(e.code, 409)
            return JSONResponse(e.payload(), status_code=status)

    @mcp.custom_route("/api/board", methods=["GET"])
    async def api_board(request: Request):
        return await api(request, lambda o, b: _async(b.board(o)))

    @mcp.custom_route("/api/initiative/{initiative_id}", methods=["GET"])
    async def api_card(request: Request):
        i = request.path_params["initiative_id"]
        return await api(request, lambda o, b: _async(b.card(o, i)))

    @mcp.custom_route("/api/start", methods=["POST"])
    async def api_start(request: Request):
        body = await request.json()
        return await api(request, lambda o, b: b.start(o, body))

    @mcp.custom_route("/api/submit", methods=["POST"])
    async def api_submit(request: Request):
        body = await request.json()
        return await api(request, lambda o, b: b.submit(o, body))

    @mcp.custom_route("/api/control", methods=["POST"])
    async def api_control(request: Request):
        body = await request.json()
        return await api(request, lambda o, b: b.control(o, body))

    @mcp.custom_route("/api/hooks/tracker", methods=["POST"])
    async def hook_tracker(request: Request):
        # Не протокольный вызов: без Bearer-исполнителя, секрет вебхука в своём
        # заголовке (TRACKER_HOOK_TOKEN). Приёмник — tracker_hooks.receive.
        from . import tracker_hooks
        raw = await request.body()
        try:
            body = json.loads(raw) if raw else None
        except Exception:  # noqa: BLE001
            body = None
        headers = {k.lower(): v for k, v in request.headers.items()}
        status, payload = tracker_hooks.receive(body, headers, config.TRACKER_HOOK_TOKEN, raw)
        return JSONResponse(payload, status_code=status)

    @mcp.custom_route("/metrics", methods=["GET"])
    async def metrics(request: Request):
        """Метрики состояния для коллектора (без токена: только счётчики по перечислимым значениям, порт — на 127.0.0.1)."""
        from starlette.responses import Response
        from .metrics import render, store_registry
        try:
            body = render(store_registry(make_store(config.DATABASE_URL)))
        except Exception:  # noqa: BLE001
            log.exception("метрики")
            return Response("хранилище недоступно", status_code=503)
        return Response(body, media_type="text/plain; version=0.0.4")

    @mcp.custom_route("/health", methods=["GET"])
    async def health(request: Request):
        return JSONResponse({"ok": True})

    return mcp


async def _async(v):
    return v


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    build_app().run(transport="http", host=config.env("HOST", "0.0.0.0"), port=int(config.env("PORT", "8700")))
