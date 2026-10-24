#!/usr/bin/env python3
"""Сид Шлюза (Т11): агент коробки + демо-заказчик + smoke-комната.

Регистрация — через shared-secret admin API Synapse (GET nonce → HMAC-SHA1).
Идемпотентен: существующий пользователь (400 user_exists) — не ошибка; токен
агента дописывается в .env (MATRIX_AGENT_TOKEN) для воркера. Smoke-комната
#bft-demo создаётся с первым вопросом — заказчик видит диалог сразу.
"""
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.parse
import urllib.request

BASE = os.environ.get("MATRIX_SEED_URL", "http://127.0.0.1:8008")
SECRET = os.environ["MATRIX_REG_SECRET"]
SERVER = os.environ.get("MATRIX_SERVER_NAME", "bft.local")
AGENT = os.environ.get("MATRIX_AGENT_USER", "bft-box")
CUSTOMER = os.environ.get("MATRIX_DEMO_CUSTOMER", "customer-demo")
ENV_FILE = os.environ.get("MATRIX_SEED_ENV", os.path.join(os.path.dirname(__file__), "..", ".env"))


def http(method, path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{BASE}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            text = res.read().decode()
            return res.status, json.loads(text) if text else {}
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def register(username, password):
    """Admin shared-secret: nonce → HMAC-SHA1(nonce\\0user\\0pass\\0notadmin)."""
    code, nonce_res = http("GET", "/_synapse/admin/v1/register")
    if code != 200:
        return None, f"nonce: {code}"
    nonce = nonce_res["nonce"]
    mac = hmac.new(SECRET.encode(), f"{nonce}\0{username}\0{password}\0notadmin".encode(), hashlib.sha1).hexdigest()
    code, res = http("POST", "/_synapse/admin/v1/register",
                     {"nonce": nonce, "username": username, "password": password,
                      "mac": mac, "admin": False, "user_type": None})
    return (code, res)


def wait_up():
    # /health отвечает телом «OK» — это НЕ JSON: лёгкий зонд без разбора,
    # иначе json.loads ронял каждую попытку и «не поднялся» при живом сервере.
    for _ in range(90):
        try:
            with urllib.request.urlopen(f"{BASE}/health", timeout=5) as res:
                if res.status == 200:
                    return
        except Exception:  # noqa: BLE001
            pass
        time.sleep(2)
    print("✗ Synapse не поднялся за 3 минуты", file=sys.stderr)
    sys.exit(1)


def set_env(key, value):
    lines = []
    seen = False
    if os.path.exists(ENV_FILE):
        for line in open(ENV_FILE, encoding="utf-8"):
            if line.startswith(f"{key}="):
                line = f"{key}={value}\n"
                seen = True
            lines.append(line)
    if not seen:
        lines.append(f"{key}={value}\n")
    open(ENV_FILE, "w", encoding="utf-8").writelines(lines)


def main():
    wait_up()
    agent_pass = os.environ.get("MATRIX_AGENT_PASSWORD") or hashlib.sha256(
        (SECRET + "agent").encode()).hexdigest()[:24]
    customer_pass = os.environ.get("MATRIX_DEMO_PASSWORD") or hashlib.sha256(
        (SECRET + "customer").encode()).hexdigest()[:24]

    code, res = register(AGENT, agent_pass)
    if code in (200,):
        print(f"✓ агент @{AGENT}:{SERVER}, токен получен")
    elif code == 400 and "user already exists" in json.dumps(res).lower():
        print(f"• агент @{AGENT} уже есть")
    else:
        print(f"✗ агент: {code} {res}", file=sys.stderr)
        sys.exit(1)
    token = res.get("access_token", "")

    if not token:
        # существующий агент: логин паролем
        code, login = http("POST", "/_matrix/client/v3/login",
                           {"type": "m.login.password",
                            "identifier": {"type": "m.id.user", "user": AGENT},
                            "password": agent_pass})
        if code != 200:
            print(f"✗ вход агента: {code}", file=sys.stderr)
            sys.exit(1)
        token = login["access_token"]
        print("• вход агента существующим паролем")

    code, _ = register(CUSTOMER, customer_pass)
    if code == 200:
        print(f"✓ демо-заказчик @{CUSTOMER}:{SERVER}, пароль: {customer_pass} (демо-контур, смените в проде)")
    elif code == 400 and "user already exists" in json.dumps(_ or {}).lower():
        print(f"• демо-заказчик @{CUSTOMER} уже есть")
    else:
        print(f"⚠ демо-заказчик: {code} (не блокирует)")

    # Токен агента — воркеру (Т12 слушатель); следующий up подхватит env.
    set_env("MATRIX_AGENT_TOKEN", token)
    print("✓ MATRIX_AGENT_TOKEN записан в .env")

    # Smoke-комната: заказчик видит диалог сразу (US-35).
    code, room = http("POST", "/_matrix/client/v3/createRoom", {
        "room_alias_name": "bft-demo",
        "name": "БФТ: демонстрация шлюза",
        "topic": "Пример комнаты инициативы",
        "preset": "private_chat",
        "invite": [f"@{CUSTOMER}:{SERVER}"],
    }, token=token)
    if code in (200,):
        print(f"✓ smoke-комната #bft-demo:{SERVER} ({room['room_id']}), приглашение @{CUSTOMER}")
        code2, sent = http("POST",
                           f"/_matrix/client/v3/rooms/{urllib.parse.quote(room['room_id'])}/send/m.room.message",
                           {"msgtype": "m.text",
                            "body": "❓ Демонстрация: подтвердите получение этого сообщения "
                                    "ответом в чате — система зафиксирует договорённость."},
                           token=token)
        print(f"  первое сообщение: {code2}")
    elif code == 400 and "alias" in json.dumps(room).lower():
        print("• smoke-комната уже есть")
    else:
        print(f"⚠ smoke-комната: {code} {room}")

    print("✓ Сид Шлюза завершён")


if __name__ == "__main__":
    main()
