#!/usr/bin/env python3
"""Сид Трекера (Т10): админ → квартальный проект → лейблы → вебхук в Коробку → команда.

Идемпотентен: повторный прогон находит проект по заголовку и не плодит дубли.
Работает с хоста против опубликованного порта (TRACKER_BIND, по умолчанию
127.0.0.1:3456); вебхук целится внутрь compose-сети (box-mcp:8700).
"""
import json
import os
import sys
import time
import urllib.request

# Совпадает с коробкой (bftbox/tracker_hooks.TRACKED_EVENTS).
TRACKED_EVENTS = ("task.done", "task.updated", "task.comment.created")

BASE = os.environ.get("TRACKER_SEED_URL", "http://127.0.0.1:3456/api/v1")
ADMIN = {"username": os.environ.get("TRACKER_ADMIN_USER", "bft-admin"),
         "email": os.environ.get("TRACKER_ADMIN_EMAIL", "admin@bft.local"),
         "password": os.environ["TRACKER_ADMIN_PASSWORD"]}
HOOK_TOKEN = os.environ["TRACKER_HOOK_TOKEN"]
BOX_HOOK = os.environ.get("TRACKER_HOOK_TARGET", "http://box-mcp:8700/api/hooks/tracker")
QUARTER = os.environ.get("TRACKER_PROJECT", "БФТ 2026-Q4")
LABELS = [("сборочная", "0e7490"), ("верификационная", "047857"),
          ("коммуникационная", "b45309"), ("сессионная", "7c3aed"),
          ("запрос", "69758a"),   # метка заявок портала заказчика (ADR-0007)
          ("бфт", "1d4ed8")]      # задачи «Проработка БФТ» (ADR-0009)
# Команда PO/аналитиков — кого «Управление БФТ» назначает ответственным
# (ADR-0009): логин:Имя через запятую; учётки получают доступ к проекту.
TEAM = os.environ.get("TRACKER_TEAM", "po-sokolova:Анна Соколова (PO),"
                      "an-orlov:Дмитрий Орлов (аналитик),an-kim:Мария Ким (аналитик)")
TEAM_PASSWORD = os.environ.get("TRACKER_TEAM_PASSWORD", "")


def call(method, path, token=None, body=None, retries=1):
    url = f"{BASE}{path}"
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, method=method)
            if token:
                req.add_header("Authorization", f"Bearer {token}")
            if body is not None:
                req.add_header("Content-Type", "application/json")
                req.data = json.dumps(body).encode()
            with urllib.request.urlopen(req, timeout=10) as res:
                text = res.read().decode()
                return res.status, json.loads(text) if text else {}
        except urllib.error.HTTPError as e:
            detail = e.read().decode()[:200]
            if e.code == 400 and "already" not in detail.lower():
                return e.code, {"detail": detail}
            return e.code, {"detail": detail}
        except Exception as e:  # noqa: BLE001
            if attempt + 1 == retries:
                raise
            time.sleep(2)
    raise RuntimeError("unreachable")


def wait_up():
    for _ in range(60):
        try:
            call("GET", "/info", retries=1)
            return
        except Exception:  # noqa: BLE001
            time.sleep(2)
    print("✗ Трекер не поднялся за 2 минуты", file=sys.stderr)
    sys.exit(1)


def main():
    wait_up()
    code, _ = call("POST", "/register", body=ADMIN)
    if code not in (200, 400):
        print(f"✗ регистрация админа: {code}", file=sys.stderr)
        sys.exit(1)
    code, login = call("POST", "/login", body={"username": ADMIN["username"], "password": ADMIN["password"]})
    if code != 200:
        print(f"✗ вход: {code} {login}", file=sys.stderr)
        sys.exit(1)
    token = login["token"]

    code, projects = call("GET", "/projects", token=token)
    existing = next((p for p in projects if p["title"] == QUARTER), None)
    if existing:
        project = existing
        print(f"• проект уже есть: {project['title']} (id {project['id']})")
    else:
        code, project = call("PUT", "/projects", token=token, body={"title": QUARTER})
        if code != 201:
            print(f"✗ проект: {code} {project}", file=sys.stderr)
            sys.exit(1)
        print(f"✓ проект: {project['title']} (id {project['id']})")

    pid = project["id"]
    code, labels = call("GET", "/labels", token=token)
    have = {l["title"]: l["id"] for l in labels}
    for title, color in LABELS:
        if title in have:
            print(f"• лейбл есть: {title}")
            continue
        code, made = call("PUT", "/labels", token=token, body={"title": title, "hex_color": color})
        if code == 201:
            print(f"✓ лейбл: {title}")
        else:
            print(f"⚠ лейбл {title}: {code} {made}")

    code, hooks = call("GET", f"/projects/{pid}/webhooks", token=token)
    hook_list = hooks if isinstance(hooks, list) else hooks.get("webhooks", [])
    if any(h.get("target_url") == BOX_HOOK for h in hook_list):
        print("• вебхук уже стоит")
    else:
        code, made = call("PUT", f"/projects/{pid}/webhooks", token=token,
                          body={"target_url": BOX_HOOK, "secret": HOOK_TOKEN,
                                "events": list(TRACKED_EVENTS)})
        if code in (200, 201):
            print(f"✓ вебхук: {BOX_HOOK}")
        else:
            print(f"⚠ вебхук: {code} {made}")

    seed_team(token, pid)
    print("✓ Сид Трекера завершён")


def seed_team(token, pid):
    """Учётки команды и доступ к проекту (право «запись»): их видит поиск исполнителя."""
    if not TEAM_PASSWORD:
        print("• команда пропущена: нет TRACKER_TEAM_PASSWORD (генерирует start.sh)")
        return
    code, shared = call("GET", f"/projects/{pid}/projectusers", token=token)
    have = {u["username"] for u in shared} if isinstance(shared, list) else set()
    for entry in filter(None, (e.strip() for e in TEAM.split(","))):
        username, _, name = entry.partition(":")
        if username in have:
            print(f"• в команде: {username}")
        else:
            code, _ = call("POST", "/register", body={"username": username, "email": f"{username}@bft.local",
                                                      "password": TEAM_PASSWORD})
            if code not in (200, 400):
                print(f"⚠ учётка {username}: {code}")
                continue
            code, made = call("PUT", f"/projects/{pid}/users", token=token, body={"username": username, "permission": 1})
            print(f"✓ в команде: {username} ({name})" if code in (200, 201) else f"⚠ доступ {username}: {code} {made}")
        set_name(username, name)


def set_name(username, name):
    """Имя для карточек: настройки Vikunja принимаются только целиком (POST всех полей)."""
    code, login = call("POST", "/login", body={"username": username, "password": TEAM_PASSWORD})
    if code != 200 or not name:
        return
    code, user = call("GET", "/user", token=login["token"])
    settings = user.get("settings") or {} if code == 200 else {}
    if settings and settings.get("name") != name:
        call("POST", "/user/settings/general", token=login["token"], body={**settings, "name": name})


if __name__ == "__main__":
    main()
