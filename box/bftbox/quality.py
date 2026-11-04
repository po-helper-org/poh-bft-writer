"""Проверки качества кодом поверх модели (ADR 0001).

Модель предлагает пакет, светофор и указания; здесь всё, что проверяется кодом, проверяется кодом:
каталог проверок, «зелёная без доказательства не бывает», якоря-цитаты, разделы документа, наличие документов
пакета, допустимые переходы состояний, адресаты вне плана, застрявшая проверка. Эти правила не зависят от того,
какая модель стоит за коробкой.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field

NO_DATA = "Нет данных — см. указания этой итерации."
DOC_KINDS = ("bft", "raci", "blueprint", "epic")
ACTIVE = ("goal", "brief", "plan_approval", "working", "acceptance", "needs_po")
# куда модель может вести инициативу из текущего состояния (accepted ставит только решение PO)
TRANSITIONS = {
    "goal": {"brief"},
    "brief": {"brief", "plan_approval"},
    "plan_approval": {"plan_approval", "working"},
    "working": {"working", "acceptance", "needs_po"},
    "needs_po": {"working", "needs_po", "acceptance"},
    "acceptance": {"working", "acceptance"},
}
NEGATIVE = ("не ", "нет", "верн", "доработ", "отклон", "отказ")


def is_approval(text: str) -> bool:
    """Решение PO в свободной форме: «Утверждаю», «Принять» — да; «Нет», «Вернуть: …» — нет."""
    t = (text or "").strip().lower()
    return bool(t) and not t.startswith(NEGATIVE)


@dataclass
class Policy:
    checks: list = field(default_factory=list)
    required_sections: tuple = ("Цель", "How to demo", "Открытые вопросы", "Границы")
    stuck_after: int = 3
    strict: bool = True   # False — только структура протокола (прогон эталонов контракта, где документы-заглушки)

    @classmethod
    def load(cls, path: str | None = None, strict: bool = True) -> "Policy":
        path = path or os.environ.get("CHECKS_FILE") or os.path.join(os.path.dirname(__file__), "..", "config", "checks.json")
        with open(path, encoding="utf-8") as f:
            cfg = json.load(f)
        return cls(cfg["checks"], tuple(cfg.get("required_sections", cls.required_sections)),
                   int(cfg.get("stuck_after_iterations", 3)), strict)

    def by_id(self) -> dict:
        return {c["id"]: c for c in self.checks}


def has_section(content: str, name: str) -> bool:
    return bool(re.search(rf"^#{{1,6}}\s*{re.escape(name)}\b", content or "", re.I | re.M))


def quotes(evidence: str) -> list:
    return re.findall(r"[«\"]([^»\"]{6,})[»\"]", evidence or "")


def normalize_checks(policy: Policy, produced: list, docs: dict, corpus: str) -> tuple:
    """Светофор по каталогу. Возвращает (проверки, заметки о том, что код понизил)."""
    given = {c.get("id"): c for c in (produced or []) if isinstance(c, dict)}
    out, notes = [], []
    for spec in policy.checks:
        c = given.get(spec["id"]) or {}
        status = c.get("status") if c.get("status") in ("red", "yellow", "green") else "red"
        evidence = str(c.get("evidence") or "").strip()
        if status == "red" and not evidence:
            evidence = NO_DATA
        if status == "green" and not evidence:
            status, evidence = "yellow", "Зелёный без доказательства не принимается."
            notes.append(f"{spec['id']}: нет доказательства")
        if policy.strict and status == "green":
            why = None
            for q in quotes(evidence):
                if q.strip().lower() not in corpus:
                    why = f"цитата «{q[:40]}» не найдена в материалах инициативы"
                    break
            if not why and spec.get("document") and not (docs.get(spec["document"]) or {}).get("content", "").strip():
                why = f"нет документа «{spec['document']}»"
            if not why and spec.get("section") and not has_section((docs.get("bft") or {}).get("content", ""), spec["section"]):
                why = f"в БФТ нет раздела «{spec['section']}»"
            if why:
                status, evidence = "yellow", f"{evidence} [код: {why}]"
                notes.append(f"{spec['id']}: {why}")
        out.append({"id": spec["id"], "title": spec["title"], "status": status, "evidence": evidence})
    return out, notes


def all_green(checks: list) -> bool:
    return bool(checks) and all(c["status"] == "green" for c in checks)


def missing_sections(policy: Policy, docs: dict) -> list:
    content = (docs.get("bft") or {}).get("content", "")
    return [s for s in policy.required_sections if not has_section(content, s)]
