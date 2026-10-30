#!/usr/bin/env python3
"""Сквозной прогон живого стека по MCP: start → итерации → решения PO → принято. Нужны BOX_URL и BOX_TOKEN.

    BOX_URL=http://127.0.0.1:8700 BOX_TOKEN=... python scripts/smoke.py "Выгрузка заказов в CSV" "Бухгалтер вручную копирует заказы"
"""
import asyncio
import os
import sys
import time
import uuid

from fastmcp import Client

URL = os.environ.get("BOX_URL", "http://127.0.0.1:8700").rstrip("/") + "/mcp"
TOKEN = os.environ["BOX_TOKEN"]


async def main(goal: str, brief: str):
    async with Client(URL, auth=TOKEN) as c:
        async def call(name, **args):
            return (await c.call_tool(name, args)).structured_content or {}

        run = uuid.uuid4().hex[:6]
        ack = await call("start", request={"schema_version": "1.0.0", "goal": goal, "brief": brief, "team": "team-a",
                                           "external_refs": {"smoke": run}, "idempotency_key": f"smoke-{run}-0"})
        print("start →", ack["initiative_id"], ack["iteration_id"], ack["status"])
        ini, n = ack["initiative_id"], 0
        while True:
            it = None
            for _ in range(120):   # итерация готовится: ждём
                it = await call("get", iteration_id=ack["iteration_id"])
                if it.get("status") != "preparing":
                    break
                await asyncio.sleep(1)
            greens = "".join({"red": "🔴", "yellow": "🟡", "green": "🟢"}[x["status"]] for x in it.get("checks", []))
            print(f"итерация {it['number']} · {it['state']} · {greens} · указаний: {len(it.get('directives', []))}")
            outcomes = [{"directive_id": d["id"], "result": "answer", "by_role": "po",
                         "content": "Утверждаю" if d["kind"] in ("approve_plan", "accept_package") else "Ответ за 2 секунды, до 10 тысяч строк"}
                        for d in it.get("directives", [])]
            if not outcomes:
                break
            n += 1
            ack = await call("submit", request={"schema_version": "1.0.0", "initiative_id": ini, "base_iteration": it["iteration_id"],
                                                "outcomes": outcomes, "idempotency_key": f"smoke-{run}-{n}"})
            if "error" in ack:
                sys.exit(f"ошибка: {ack}")
            if not ack.get("new_iteration"):
                break
        st = await call("status", initiative_id=ini)
        print("статус:", st["state"])
        md = (await c.call_tool("get", {"iteration_id": it["iteration_id"], "format": "md"})).content[0].text
        print(md[:300])
        assert st["state"] == "accepted", st


if __name__ == "__main__":
    asyncio.run(main(*(sys.argv[1:3] or ["Выгрузка заказов в CSV", "Бухгалтер раз в неделю вручную копирует заказы в таблицу"])))
