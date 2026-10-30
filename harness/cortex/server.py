#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Кортекс как сервис коробки (ADR-0011): память организации — только на чтение.

poh-cortex — markdown в git и один CLI на стандартной библиотеке. Сервис не
переписывает его логику, а загружает тот же `bin/cortex` модулем и отвечает
по HTTP на четыре вопроса, которые нужны быстрой версии БФТ:

  1. о ком идёт речь — сотрудники (Нексус team: роль, зоны, «к кому по чему»);
  2. что уже известно о бизнес-процессах (эмпирические узлы вне team/landscape);
  3. домены и зоны влияния — владельцы найденного знания и их зоны;
  4. IT-ландшафт — системы, где и как это можно проверить (Нексус landscape).

Каждый ответ — с якорем: node_id, источники, CP и свежесть. Пусто — значит
память этого не знает, и это валидный ответ (принцип Кортекса), а не ошибка.

Vault: /vault, если туда смонтирована память организации (CORTEX_VAULT), иначе
встроенная демо-память образа — ответ помечается demo: true.

  GET  /health          — vault, число узлов, демо или нет
  POST /brief {text}    — четыре раздела по тексту запроса
"""
from __future__ import annotations

import importlib.machinery
import importlib.util
import json
import os
import pathlib
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("CORTEX_PORT", "8095"))
DEMO_ROOT = pathlib.Path(os.environ.get("CORTEX_DEMO", "/opt/demo-vault"))
VAULT_ROOT = pathlib.Path(os.environ.get("CORTEX_VAULT_ROOT", "/vault"))
BUILTIN_TOOL = pathlib.Path(os.environ.get("CORTEX_TOOL", "/opt/poh-cortex/bin/cortex"))
TOP = 4


def vault_root() -> tuple[pathlib.Path, bool]:
    """Смонтированная память организации, иначе демо."""
    if (VAULT_ROOT / "GROUND" / "SCHEMA").is_dir():
        return VAULT_ROOT, False
    return DEMO_ROOT, True


def load_tool(root: pathlib.Path):
    """bin/cortex самого vault (его версия методологии), иначе — из образа."""
    path = root / "bin" / "cortex"
    if not path.is_file():
        path = BUILTIN_TOOL
    loader = importlib.machinery.SourceFileLoader("cortex_cli", str(path))
    spec = importlib.util.spec_from_loader("cortex_cli", loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


class Memory:
    """Индекс vault в памяти; пересобирается, если в GROUND что-то поменялось."""

    def __init__(self):
        self.lock = threading.Lock()
        self.stamp = None
        self.cx = self.idx = self.tool = None
        self.root, self.demo = vault_root()

    def _stamp(self) -> float:
        newest = 0.0
        for p in (self.root / "GROUND").rglob("*"):
            try:
                newest = max(newest, p.stat().st_mtime)
            except OSError:
                pass
        return newest

    def get(self):
        with self.lock:
            stamp = self._stamp()
            if self.cx is None or stamp != self.stamp:
                self.tool = self.tool or load_tool(self.root)
                self.cx = self.tool.Cortex(self.root)
                self.idx = self.tool.Index(self.cx)
                self.stamp = stamp
            return self.tool, self.cx, self.idx


MEMORY = Memory()


def summary_of(node) -> str:
    """Первый абзац тела узла — коротко, без заголовков."""
    for block in re.split(r"\n\s*\n", node.body or ""):
        text = " ".join(line.strip() for line in block.splitlines() if not line.lstrip().startswith("#")).strip()
        if text:
            return text[:280]
    return ""


def as_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return [str(v) for v in value if str(v).strip()]
    return [str(value)]


def hits(idx, text: str, keep, top: int = TOP):
    """Поиск Кортекса + отсечка слабого: доля от лучшего, чтобы общие слова не тянули мусор."""
    found = [(s, n) for s, n in idx.search(text, top=40) if keep(n)]
    if not found:
        return []
    best = found[0][0]
    return [n for s, n in found if s >= best * 0.25][:top]


def anchor(tool, cx, node) -> dict:
    a = tool.anchors(cx, node)
    return {"node_id": a["node_id"], "title": a["title"], "owner": a["owner"], "cp": a["effective_cp"],
            "ripeness": a["ripeness"], "sources": [str(s) for s in a["sources"]][:3], "summary": summary_of(node),
            "draft": node["status"] == "draft"}


def brief(text: str) -> dict:
    tool, cx, idx = MEMORY.get()
    empirical = lambda n: n["kind"] != "normative"  # noqa: E731 — методология PAF — не знание об организации

    people = []
    for n in hits(idx, text, lambda n: n["nexus"] == "team" and n["node_type"] == "person"):
        # Шаблон кладёт роль и зоны в поля; живая память часто — в заголовок
        # «Имя — роль» и первый абзац тела (он уходит в summary).
        head, _, tail = n.title.partition(" — ")
        people.append({**anchor(tool, cx, n), "name": str(n["full_name"] or head), "role": str(n["role_title"] or tail),
                       "zones": as_list(n["influence_zones"]), "contact_for": as_list(n["contact_for"])})

    processes = [anchor(tool, cx, n) for n in hits(idx, text, lambda n: empirical(n) and n["nexus"] not in ("team", "landscape"))]

    landscape = []
    for n in hits(idx, text, lambda n: n["nexus"] == "landscape"):
        landscape.append({**anchor(tool, cx, n), "where_to_check": as_list(n["where_to_check"]), "environments": as_list(n["environments"])})

    # Зоны влияния: владельцы найденного знания (как `cortex who`) + зоны людей.
    owners: dict[str, dict] = {}
    for n in hits(idx, text, empirical, top=10):
        owner = str(n["owner"] or "").strip()
        if owner:
            owners.setdefault(owner, {"owner": owner, "zones": [], "nodes": []})["nodes"].append(n.title)
    for p in people:
        entry = owners.setdefault(p["name"], {"owner": p["name"], "zones": [], "nodes": []})
        entry["zones"] = p["zones"]
    domains = [d for d in owners.values() if d["zones"] or d["nodes"]][:TOP + 2]

    return {
        "vault": {"name": str((cx.config.get("company") or "") or cx.root.name), "nodes": len(cx.nodes), "demo": MEMORY.demo},
        "people": people, "processes": processes, "domains": domains, "landscape": landscape,
    }


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != "/health":
            return self._send(404, {"error": "not found"})
        try:
            _, cx, _ = MEMORY.get()
            self._send(200, {"ok": True, "vault": str(MEMORY.root), "demo": MEMORY.demo, "nodes": len(cx.nodes)})
        except Exception as e:  # vault битый — сервис жив, но честно говорит, что памяти нет
            self._send(503, {"ok": False, "error": str(e)})

    def do_POST(self):
        if self.path != "/brief":
            return self._send(404, {"error": "not found"})
        try:
            length = int(self.headers.get("content-length") or 0)
            data = json.loads(self.rfile.read(length) or b"{}")
            text = str(data.get("text") or "").strip()
            if not text:
                return self._send(400, {"error": "нужен text"})
            self._send(200, brief(text[:8000]))
        except Exception as e:
            self._send(500, {"error": str(e)})

    def log_message(self, fmt, *args):
        sys.stderr.write("[cortex] " + fmt % args + "\n")


if __name__ == "__main__":
    root, demo = vault_root()
    print(f"[cortex] vault {root}{' (демо)' if demo else ''} → :{PORT}", file=sys.stderr)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
