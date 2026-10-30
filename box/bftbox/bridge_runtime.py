"""Рантайм мостов (Т12): задачи Vikunja, комнаты Matrix, диспетчер и обратная дорога.

Живёт в процессах коробки: воркер крутит диспетчер и слушатель Matrix,
box-mcp принимает вебхуки Трекера. Обе стороны закрывают цикл одним и тем же
`Box.submit` от исполнителя `agent` (BOX_TOKENS) — мосты суть руки Коробки
(ADR-0003), а не агентные сессии. Весь IO — httpx-инъекция; чистая логика —
в bridges.py.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

import httpx

from . import bridges, config
from .matrix_client import MatrixClient, room_alias

log = logging.getLogger("bftbox.bridges")


class VikunjaAPI:
    """Тонкая обёртка REST Vikunja: вход, проект «БФТ …», задачи, поиск по маркеру."""

    def __init__(self, http: httpx.AsyncClient):
        self.http = http
        self.base = config.TRACKER_URL.rstrip("/")
        self._token: Optional[str] = None
        self._project_id: Optional[int] = None

    async def _login(self) -> str:
        if self._token:
            return self._token
        res = await self.http.post(f"{self.base}/login", json={
            "username": config.TRACKER_USER, "password": config.TRACKER_PASSWORD})
        res.raise_for_status()
        self._token = res.json()["token"]
        return self._token

    def _auth(self) -> dict:
        return {"Authorization": f"Bearer {self._token}"}

    async def project_id(self) -> int:
        if self._project_id:
            return self._project_id
        token = await self._login()
        res = await self.http.get(f"{self.base}/projects", headers=self._auth())
        res.raise_for_status()
        for p in res.json():
            if p["title"].startswith(config.TRACKER_PROJECT_PREFIX):
                self._project_id = p["id"]
                return p["id"]
        raise RuntimeError(f"проект «{config.TRACKER_PROJECT_PREFIX}…» не найден: прогоните сид")

    async def create_task(self, payload: dict) -> dict:
        pid = await self.project_id()
        res = await self.http.put(f"{self.base}/projects/{pid}/tasks",
                                  headers=self._auth(), json=payload)
        res.raise_for_status()
        return res.json()

    async def all_tasks(self) -> "list[tuple[str, bool]]":
        """(description, done) всех задач проекта: ссылки для идемпотентности
        и закрытые — для самовосстановления исходов."""
        pid = await self.project_id()
        out: list[tuple[str, bool]] = []
        res = await self.http.get(f"{self.base}/projects/{pid}/tasks",
                                  headers=self._auth(), params={"view": "list"})
        if res.status_code != 200:
            return out
        for t in res.json():
            out.append((t.get("description") or "", t.get("done") is True))
        return out


async def submit_outcome(box, initiative_id: str, base_iteration: str,
                         outcomes: list[dict], idem: str) -> Optional[dict]:
    """Submit от мостов; ошибки (not_ready/conflict) — предупреждение, не падение."""
    req = bridges.submit_request(initiative_id, base_iteration, outcomes, idem)
    try:
        ack = await box.submit(bridges.BRIDGE_OWNER, req)
        log.info("мосты: submit %s → %s", initiative_id, (ack or {}).get("state", ack))
        return ack
    except Exception as e:  # noqa: BLE001 — BoxError уже пойман слоем ниже
        log.warning("мосты: submit %s не прошёл (%s); повторит диспетчер", initiative_id, e)
        return None


class BridgeRuntime:
    """Диспетчер указаний + слушатель Matrix. Стартуется воркером при настройке."""

    def __init__(self, box_factory, http: Optional[httpx.AsyncClient] = None):
        self.box_factory = box_factory  # () -> Box (temporal+store)
        self.http = http or httpx.AsyncClient(timeout=15)
        self.matrix: Optional[MatrixClient] = None
        self.matrix_sync_since = ""
        self._rooms: dict[str, dict] = {}  # alias → {room_id, initiative, directive}
        if config.MATRIX_AGENT_TOKEN:
            self.matrix = MatrixClient({
                "url": config.MATRIX_URL, "token": config.MATRIX_AGENT_TOKEN,
                "user": f"@{config.MATRIX_AGENT_USER}:{config.MATRIX_SERVER_NAME}",
                "http": self.http,
            })

    # ── диспетчер: board → задачи/комнаты ──────────────────────────────────
    async def dispatch_once(self) -> int:
        box = await self.box_factory()
        cards = _admin_view(box)["initiatives"]   # board() синхронен: store + состояние
        vk = VikunjaAPI(self.http)
        try:
            # existing — ref-формы (bft:<инициатива>#<указание>), а не сырые
            # описания: иначе сравнение с ref() никогда не сходится (грабля дублей).
            existing = set()
            existing_descs = []
            closed_descs = set()
            for d, done in await vk.all_tasks():
                pr = bridges.parse_ref(d)
                if not pr:
                    continue
                existing.add(bridges.ref(*pr))
                existing_descs.append(d)
                if done:
                    closed_descs.add(pr)
        except Exception as e:  # noqa: BLE001
            log.warning("мосты: трекер недоступен (%s)", e)
            existing = set()
        # Комнаты уже созданные — тоже «существующие ссылки» (alias-ключи).
        # Ключи реестра сменились на room_id: alias-существование строим из снапшота.
        existing = {d for d in existing} | set()
        # Самовосстановление: закрытая задача с маркером, чьё указание ещё
        # открыто (submit упал/вебхук потерялся) — исход уедет здесь; тот же
        # idempotency_key, повтор безопасен.
        open_by_ref = {}
        for c in cards:
            for d in c.get("open_directives") or []:
                open_by_ref[bridges.ref(c["initiative_id"], d["id"])] = (c, d)
        for desc in list(existing_descs):
            pr = bridges.parse_ref(desc)
            if not pr:
                continue
            r = bridges.ref(*pr)
            if r in open_by_ref and pr in closed_descs:
                c, d = open_by_ref[r]
                outcome = bridges.outcome_from_tracker({"done": True, "description": desc,
                                                        "title": "", "id": 0})
                if outcome:
                    await submit_outcome(box, c["initiative_id"], c.get("latest_iteration_id", ""),
                                         [outcome], f"tracker-retry-{r}")

        made = 0
        for card, directive, route_to in bridges.plan_dispatch(cards, set()):
            r = bridges.ref(card["initiative_id"], directive["id"])
            alias_key = f"alias:{room_alias(bridges.room_slug_for(card), config.MATRIX_SERVER_NAME)}"
            try:
                # Дубль-фильтр комнат: alias уже разрешается каталогом сервера.
                if f"alias:{alias_key}" in existing or any(
                        v.get("initiative") == card["initiative_id"] and v.get("directive") == directive["id"]
                        for v in self._rooms.values()):
                    continue
                if route_to == "tracker":
                    if r in existing:
                        continue
                    await vk.create_task(bridges.tracker_task(directive, card["initiative_id"], card.get("goal", "")))
                    existing.add(r)
                    made += 1
                elif route_to == "matrix" and self.matrix:
                    slug = bridges.room_slug_for(card)
                    alias = room_alias(slug, config.MATRIX_SERVER_NAME)
                    if alias_key in existing:
                        continue
                    room = await self.matrix.create_room(
                        slug, f"БФТ: {card.get('goal', '')[:80]}",
                        [f"@{config.MATRIX_DEMO_CUSTOMER}:{config.MATRIX_SERVER_NAME}"],
                        topic=bridges.matrix_room_topic(card["initiative_id"], directive["id"], card.get("goal", "")))
                    if room.get("status") in (200,):
                        await self.matrix.send_text(
                            room["room_id"], bridges.matrix_question(directive))
                        self._rooms[room["room_id"]] = {"room_id": room["room_id"],
                                              "initiative": card["initiative_id"],
                                              "directive": directive["id"],
                                              "base": card.get("latest_iteration_id") or (card.get("latest") or {}).get("iteration_id", "")}
                        existing.add(f"alias:{alias}")
                        made += 1
            except Exception as e:  # noqa: BLE001
                log.warning("мосты: %s → %s не доехало (%s)", r, route_to, e)
        return made

    # ── Matrix: слушатель ответов ──────────────────────────────────────────
    async def matrix_listen_once(self) -> int:
        if not self.matrix:
            return 0
        data = await self.matrix.sync(self.matrix_sync_since, timeout_ms=0)
        self.matrix_sync_since = data.get("next_batch", self.matrix_sync_since)
        handled = 0
        joined = (data.get("rooms") or {}).get("join") or {}
        for room_id, chunk in joined.items():
            info = self._rooms.get(room_id) or await self._adopt_room(room_id)
            if not info:
                continue
            for ev in chunk.get("timeline", {}).get("events", []):
                from .matrix_client import parse_reply
                reply = parse_reply(ev, f"@{config.MATRIX_AGENT_USER}:{config.MATRIX_SERVER_NAME}")
                if reply:
                    box = await self.box_factory()
                    outcome = {**bridges.outcome_from_reply(reply),
                               "directive_id": info["directive"]}
                    await submit_outcome(box, info["initiative"], info["base"],
                                         [outcome],
                                         f"matrix-{info['directive']}-{ev.get('event_id', '')[:18]}")
                    handled += 1
        return handled

    async def _adopt_room(self, room_id: str) -> Optional[dict]:
        """Комната без реестра (рестарт воркера): маркер в теме ведёт к инициативе
        и указанию; base_iteration — из борда. Реестр в памяти — кэш, не истина."""
        try:
            res = await self.http.get(
                f"{config.MATRIX_URL}/_matrix/client/v3/rooms/{room_id}/state/m.room.topic",
                headers={"Authorization": f"Bearer {config.MATRIX_AGENT_TOKEN}"})
            if res.status_code != 200:
                return None
            pr = bridges.parse_ref(res.json().get("topic", ""))
            if not pr:
                return None
            initiative_id, directive_id = pr
            box = await self.box_factory()
            cards = _admin_view(box)["initiatives"]
            card = next((c for c in cards if c["initiative_id"] == initiative_id), None)
            info = {"room_id": room_id, "initiative": initiative_id, "directive": directive_id,
                    "base": (card or {}).get("latest_iteration_id", "")}
            self._rooms[room_id] = info
            return info
        except Exception as e:  # noqa: BLE001
            log.warning("мосты: комнату %s не усыновил (%s)", room_id, e)
            return None

    # ── вебхук Трекера (вызывается из mcp_server) ──────────────────────────
    async def on_tracker_event(self, event: dict) -> Optional[dict]:
        task = {"id": event.get("task_id"), "done": event.get("done"),
                "title": event.get("title", ""),
                "description": event.get("description", "")}
        # task.updated без тела: description (маркер) добираем по API.
        if task["id"] and not task["description"]:
            try:
                vk = VikunjaAPI(self.http)
                token = await vk._login()
                res = await self.http.get(f"{vk.base}/tasks/{task['id']}", headers=vk._auth())
                if res.status_code == 200:
                    full = res.json()
                    task["description"] = full.get("description", "")
                    task["title"] = full.get("title", task["title"])
                    task["done"] = full.get("done") is True or task["done"]
            except Exception as e:  # noqa: BLE001
                log.warning("мосты: задачу %s не добрал (%s)", task["id"], e)
        outcome = bridges.outcome_from_tracker(task)
        if not outcome:
            return None
        box = await self.box_factory()
        board = _admin_view(box)
        card = next((c for c in board["initiatives"]
                     if c["initiative_id"] == bridges.parse_ref(task["description"])[0]), None)
        if not card:
            log.warning("мосты: задача %s без инициативы", task["id"])
            return None
        return await submit_outcome(
            box, card["initiative_id"],
            card.get("latest_iteration_id") or (card.get("latest") or {}).get("iteration_id", ""),
            [outcome], f"tracker-{event.get('task_id')}-{outcome['directive_id']}")

    # ── циклы воркера ───────────────────────────────────────────────────────
    async def run_forever(self, interval: float = 10.0):
        log.info("мосты: диспетчер и слушатель Matrix запущены (интервал %.0fs)", interval)
        while True:
            try:
                await self.dispatch_once()
                await self.matrix_listen_once()
            except Exception as e:  # noqa: BLE001
                log.warning("мосты: цикл споткнулся (%s), продолжаю", e)
            await asyncio.sleep(interval)


def _admin_view(box):
    """board от имени admin-исполнителя: мосты видят все инициативы."""
    return box.board("ui" if "ui" in config.admins() else sorted(config.admins())[0])
