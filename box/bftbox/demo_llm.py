"""Модель-ДВОЙНИК для демо без ключа: python -m bftbox.demo_llm. Это не ИИ: фиксированный сценарий
«бриф → план → проработка → приёмка», собранный из слов брифа. Нужен, чтобы увидеть жизненный цикл, светофор и
страницу /bft без внешней модели. Качество БФТ он не показывает — для этого нужна настоящая модель."""
from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CHECKS = ["G01", "G04", "G05", "G06", "G07", "G09", "P-RACI", "P-EPIC", "P-BP"]


def doc(goal: str, brief: str, full: bool) -> str:
    head = f"# БФТ: {goal}\n\n## Цель\n{goal}. Исходная проблема: {brief}\n\n"
    if not full:
        return head + "## Открытые вопросы\n- [УТОЧНИТЬ] границы и приёмка.\n"
    return (head + "## How to demo\n1. Открыть раздел и выполнить сценарий из брифа.\n2. Убедиться, что результат совпал с ожиданием.\n\n"
            "## Открытые вопросы\n- Нет открытых вопросов, решения PO — в истории указаний.\n\n"
            "## Границы\nВходит только то, что описано в брифе. Остальное — вне границ.\n")


def produce(ctx: dict) -> dict:
    goal, brief, n = ctx["goal"], ctx["brief"] or ctx["goal"], ctx["number"]
    quote = brief[:40].strip()
    plan_ok = ctx["plan"]["approved"]
    answered = [o for o in ctx["new_outcomes"] if o["result"] == "answer"]
    docs = lambda full: [  # noqa: E731
        {"kind": "bft", "title": f"БФТ: {goal}", "content": doc(goal, brief, full)},
        {"kind": "raci", "title": "Матрица исполнения", "content": "| Стык | Поставщик | Проверяющий | Критерий |\n|---|---|---|---|\n| Бриф → БФТ | Аналитик | PO | Сценарий приёмки |"},
        {"kind": "blueprint", "title": "BluePrint-карта", "content": "Было: ручной процесс. Стало: сценарий из брифа."},
        {"kind": "epic", "title": f"Эпик: {goal}", "content": f"Эпик по БФТ «{goal}»."}]
    po = {"role": "po", "po_can_answer": True}
    if ctx["state"] in ("goal", "brief") and not plan_ok and not any(o["kind"] == "approve_plan" for o in answered) and n == 1:
        return {"summary": "[демо-модель] Черновик БФТ собран из брифа. Нужны ответы PO.", "next_state": "brief", "documents": docs(False),
                "checks": [{"id": c, "status": "red", "evidence": ""} for c in CHECKS],
                "directives": [{"kind": "ask", "to": po, "text": "Кто принимает результат и по какому критерию?", "closes": ["G04", "G07"], "expected": "fact"}]}
    if not plan_ok:
        return {"summary": "[демо-модель] План: спрашивать только PO. Утвердите план.", "next_state": "plan_approval", "plan": {"addressees": ["PO"]},
                "documents": docs(False), "checks": [{"id": c, "status": "yellow" if c == "G01" else "red", "evidence": f"«{quote}»" if c == "G01" else ""} for c in CHECKS],
                "directives": [{"kind": "approve_plan", "to": po, "text": "Утвердить план: вопросы только к PO, документы — БФТ, матрица, BluePrint, эпик.", "closes": ["G04"], "expected": "decision"}]}
    if ctx["number"] <= 3 or not any("НФТ" in (o.get("content") or "") or o["kind"] == "decide" for o in answered):
        return {"summary": "[демо-модель] Пакет собран. Остался вопрос по НФТ.", "next_state": "working", "documents": docs(True),
                "checks": [{"id": c, "status": "red" if c == "G05" else "green", "evidence": "" if c == "G05" else f"«{quote}»"} for c in CHECKS],
                "directives": [{"kind": "decide", "to": po, "text": "Какие нефункциональные требования важны (сроки, объёмы)?", "closes": ["G05"], "expected": "decision"}]}
    return {"summary": "[демо-модель] Все проверки зелёные, пакет готов к приёмке.", "next_state": "acceptance", "documents": docs(True),
            "checks": [{"id": c, "status": "green", "evidence": f"«{quote}»"} for c in CHECKS], "directives": []}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
        user = body["messages"][-1]["content"].split("\n", 1)[1]
        out = json.dumps({"choices": [{"message": {"role": "assistant", "content": json.dumps(produce(json.loads(user)), ensure_ascii=False)}}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8710), Handler).serve_forever()
