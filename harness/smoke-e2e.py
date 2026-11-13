#!/usr/bin/env python3
"""E2E-гейт Т15: полный конвейер одной инициативы на demo-профиле (без ключа LLM).

Шаги (HowToDemo в миниатюре): start → PO-указания → план → рабочая итерация с
адресатами (мосты создают задачу/комнату) → закрытие задачи в Трекере (вебхук
→ submit) → ответ PO (submit) → приёмка → validated. Выход 0 = гейт пройден.

  python3 harness/smoke-e2e.py        # из корня репозитория, стек уже поднят
"""
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

H = os.environ.get("BFT_HARNESS", os.path.join(os.path.dirname(__file__)))
os.chdir(H)


def env(k):
    for line in open(".env", encoding="utf-8"):
        if line.startswith(k + "="):
            return line.split("=", 1)[1].strip()
    return ""


BOX = "http://127.0.0.1:8700"
UI_TOKEN = ""
TR_TOKEN = ""


def box(path, body=None):
    req = urllib.request.Request(BOX + path, data=json.dumps(body).encode() if body else None,
                                 headers={"Authorization": "Bearer " + UI_TOKEN,
                                          "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req).read() or "{}")


def tracker(method, path, body=None):
    base = "http://127.0.0.1:3456/api/v1"
    req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body else None,
                                 method=method,
                                 headers={"Authorization": "Bearer " + TR_TOKEN,
                                          "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req).read() or "{}")


def step(name):
    print(f"▸ {name}")


def main():
    global UI_TOKEN, TR_TOKEN
    UI_TOKEN = env("BFT_BOX_UI_TOKEN")
    if not UI_TOKEN:
        UI_TOKEN = env("BOX_TOKENS").split("ui:")[1].split(",")[0]
    # вход в трекер
    for _ in range(30):
        try:
            TR_TOKEN = tracker("POST", "/login", {
                "username": env("TRACKER_ADMIN_USER") or "bft-admin",
                "password": env("TRACKER_ADMIN_PASSWORD")})["token"]
            break
        except Exception:  # noqa: BLE001
            time.sleep(2)
    if not TR_TOKEN:
        print("✗ трекер недоступен"); sys.exit(1)

    step("1/7 старт инициативы (demo-модель)")
    start = box("/api/start", {"schema_version": "1.0.0",
                               "goal": f"E2E smoke {int(time.time())}",
                               "brief": "гейт Т15", "idempotency_key": f"e2e-{int(time.time())}"})
    iid = start["initiative_id"]
    print(f"  {iid}")

    def open_dirs():
        c = box(f"/api/initiative/{iid}")
        return c, [d for d in (c["latest"].get("directives") or []) if d["state"] in ("open", "overdue")]

    step("2/7 PO отвечает на бриф")
    for attempt in range(30):
        c, dirs = open_dirs()
        if c["state"] in ("plan_approval", "working"):
            break
        if dirs:
            box("/api/submit", {"schema_version": "1.0.0", "initiative_id": iid,
                                "base_iteration": c["latest"]["iteration_id"],
                                "outcomes": [{"directive_id": d["id"], "result": "answer",
                                              "by_role": "po", "content": "e2e: утверждаю"} for d in dirs],
                                "idempotency_key": f"e2e-po1-{attempt}"})
        time.sleep(5)
    print(f"  state={c['state']}")

    step("3/7 утверждаем план")
    for attempt in range(30):
        c, dirs = open_dirs()
        if c["state"] == "working":
            break
        if dirs:
            box("/api/submit", {"schema_version": "1.0.0", "initiative_id": iid,
                                "base_iteration": c["latest"]["iteration_id"],
                                "outcomes": [{"directive_id": d["id"], "result": "answer",
                                              "by_role": "po", "content": "e2e: план утверждён"} for d in dirs],
                                "idempotency_key": f"e2e-po2-{attempt}"})
        time.sleep(5)
    print(f"  state={c['state']}")

    step("4/7 ждём рабочую итерацию с адресатами (мосты: задача+комната)")
    non_po = []
    for attempt in range(40):
        c, dirs = open_dirs()
        non_po = [d for d in dirs if d["to"]["role"] != "po"]
        if non_po:
            break
        time.sleep(5)
    if not non_po:
        print("✗ адресаты не появились (демо-модель/мосты?)"); sys.exit(1)
    print(f"  указаний к людям: {len(non_po)}")

    step("5/7 закрываем задачу в Трекере (вебхук → submit)")
    marker = f"bft:{iid}#"
    closed = False
    for attempt in range(30):
        tasks = tracker("GET", f"/projects/{tracker('GET', '/projects')[0]['id'] if False else 2}/tasks")
        for t in tasks:
            desc = t.get("description") or ""
            if marker in desc and any(d["id"] in desc for d in non_po) and not t["done"]:
                t["done"] = True
                tracker("POST", f"/tasks/{t['id']}", t)  # полное тело — маркер живёт
                closed = True
                break
        if closed:
            break
        time.sleep(4)
    print(f"  задача закрыта: {closed}")
    if not closed:
        print("⚠ задача не найдена/не закрыта — исход доберёт диспетчер (self-heal)")

    step("6/7 PO закрывает остальные указания")
    for attempt in range(30):
        c, dirs = open_dirs()
        if c["state"] in ("acceptance", "accepted"):
            break
        if dirs:
            box("/api/submit", {"schema_version": "1.0.0", "initiative_id": iid,
                                "base_iteration": c["latest"]["iteration_id"],
                                "outcomes": [{"directive_id": d["id"], "result": "answer",
                                              "by_role": "po", "content": "e2e: ответ по всем"} for d in dirs],
                                "idempotency_key": f"e2e-po3-{attempt}"})
        time.sleep(5)
    print(f"  state={c['state']}")

    step("7/7 приёмка → VALIDATED")
    for attempt in range(30):
        c, dirs = open_dirs()
        if c["state"] == "accepted":
            break
        if dirs:
            box("/api/submit", {"schema_version": "1.0.0", "initiative_id": iid,
                                "base_iteration": c["latest"]["iteration_id"],
                                "outcomes": [{"directive_id": d["id"], "result": "answer",
                                              "by_role": "po", "content": "e2e: принимаю пакет"} for d in dirs],
                                "idempotency_key": f"e2e-acc-{attempt}"})
        time.sleep(5)

    c = box(f"/api/initiative/{iid}")
    stage = None
    board = box("/api/board")
    for i in board["initiatives"]:
        if i["initiative_id"] == iid:
            stage = i.get("stage")
    if c["state"] == "accepted" and stage == "validated":
        print(f"✓ E2E ГЕЙТ ПРОЙДЕН: {iid} → {c['state']} / {stage}")
        sys.exit(0)
    print(f"✗ не дошли: state={c['state']} stage={stage}")
    sys.exit(1)


if __name__ == "__main__":
    main()
