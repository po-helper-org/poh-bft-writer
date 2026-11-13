"""Проверки качества кодом (ADR 0001): модель предлагает, код не даёт выпустить непроработанное."""
import datetime as dt

from bftbox.engine import Engine, parse_ts
from bftbox.quality import Policy

NOW = parse_ts("2026-10-20T09:00:00Z")
BFT = """# БФТ: выгрузка заказов

## Цель
Бухгалтерия не тратит 3 часа в неделю на ручное копирование.

## How to demo
1. Открыть раздел «Заказы», нажать «Выгрузить».

## Открытые вопросы
- Какие поля нужны?

## Границы
Только оплаченные заказы за месяц.
"""


def good(**over) -> dict:
    p = {"summary": "ок", "next_state": "brief",
         "documents": [{"kind": "bft", "title": "БФТ", "content": BFT},
                       {"kind": "raci", "title": "RACI", "content": "| Стык | Поставщик |"},
                       {"kind": "blueprint", "title": "BP", "content": "было → стало"},
                       {"kind": "epic", "title": "Эпик", "content": "PROJ-1 связан с БФТ"}],
         "checks": [{"id": c, "status": "green", "evidence": "раздел «Границы»: Только оплаченные заказы за месяц"}
                    for c in ("G01", "G04", "G05", "G06", "G07", "G09", "P-RACI", "P-EPIC", "P-BP")],
         "directives": []}
    p.update(over)
    return p


def started(strict=True):
    e, _, work = Engine.start(Policy.load(strict=strict), "ini-0001",
                              {"schema_version": "1.0.0", "goal": "Выгрузка заказов", "brief": "Бухгалтер копирует заказы вручную",
                               "team": "team-a", "idempotency_key": "k"}, "po", NOW)
    return e, work


def status_of(it, cid):
    return next(c for c in it["checks"] if c["id"] == cid)


def test_green_without_evidence_becomes_yellow():
    e, w = started()
    p = good()
    p["checks"][0]["evidence"] = ""
    it = e.complete(w.iteration_id, p, NOW)
    assert status_of(it, "G01")["status"] == "yellow"
    assert "G01" in it["summary"]


def test_quote_must_exist_in_materials():
    e, w = started()
    p = good()
    p["checks"][0]["evidence"] = "в брифе сказано «заказчик требует интеграцию с SAP»"
    it = e.complete(w.iteration_id, p, NOW)
    c = status_of(it, "G01")
    assert c["status"] == "yellow" and "не найдена" in c["evidence"]


def test_checks_missing_a_document_or_section_cannot_be_green():
    e, w = started()
    p = good(documents=[{"kind": "bft", "title": "БФТ", "content": "# БФТ\n\n## Цель\nтолько цель"}])
    it = e.complete(w.iteration_id, p, NOW)
    assert status_of(it, "P-EPIC")["status"] == "yellow"      # нет эпика
    assert status_of(it, "G04")["status"] == "yellow"         # нет раздела «Границы»
    assert status_of(it, "G07")["status"] == "yellow"         # нет раздела «Открытые вопросы»


def test_every_catalog_check_is_present():
    e, w = started()
    it = e.complete(w.iteration_id, good(checks=[]), NOW)
    assert [c["id"] for c in it["checks"]] == [c["id"] for c in e.policy.checks]
    assert all(c["status"] == "red" for c in it["checks"])


def test_acceptance_refused_while_any_check_is_not_green():
    e, w = started()
    e.plan = {"approved": True, "addressees": []}
    e.state = "working"
    p = good(next_state="acceptance")
    p["checks"][2]["status"] = "red"
    it = e.complete(w.iteration_id, p, NOW)
    assert it["state"] == "working" and "приёмка отложена" in it["summary"]


def test_acceptance_when_all_green_asks_po_to_accept_and_po_accepts():
    e, w = started()
    e.plan = {"approved": True, "addressees": []}
    e.state = "working"
    it = e.complete(w.iteration_id, good(next_state="acceptance"), NOW)
    assert it["state"] == "acceptance" and [d["kind"] for d in it["directives"]] == ["accept_package"]
    ack, work = e.submit({"schema_version": "1.0.0", "initiative_id": "ini-0001", "base_iteration": it["iteration_id"],
                          "idempotency_key": "a", "outcomes": [{"directive_id": it["directives"][0]["id"], "result": "answer",
                                                                "by_role": "po", "content": "Принять"}]}, NOW)
    assert work is None and ack["state"] == "accepted" and e.status()["state"] == "accepted"


def test_po_returning_the_package_goes_back_to_work_with_feedback():
    e, w = started()
    e.plan = {"approved": True, "addressees": []}
    e.state = "working"
    it = e.complete(w.iteration_id, good(next_state="acceptance"), NOW)
    ack, work = e.submit({"schema_version": "1.0.0", "initiative_id": "ini-0001", "base_iteration": it["iteration_id"],
                          "idempotency_key": "a", "outcomes": [{"directive_id": it["directives"][0]["id"], "result": "answer",
                                                                "by_role": "po", "content": "Вернуть: не хватает НФТ по срокам"}]}, NOW)
    assert work is not None and ack["state"] == "acceptance"
    assert "НФТ по срокам" in e.context(work.iteration_id, NOW)["feedback"][-1]


def test_stuck_check_goes_to_po_with_a_decide_directive():
    e, w = started()
    e.plan = {"approved": True, "addressees": []}
    e.state = "working"
    it = None
    for n in range(3):
        p = good(next_state="working")
        p["checks"][3] = {"id": "G06", "status": "red", "evidence": ""}
        it = e.complete(w.iteration_id, p, NOW)
        if n < 2:
            _, w2 = e.submit({"schema_version": "1.0.0", "initiative_id": "ini-0001", "base_iteration": it["iteration_id"],
                              "idempotency_key": f"i{n}", "outcomes": [], "iterate": True}, NOW)
            w = w2
    assert it["state"] == "needs_po"
    assert any(d["kind"] == "decide" and d["closes"] == ["G06"] for d in it["directives"])


def test_addressee_outside_the_plan_becomes_a_plan_change_for_po():
    e, w = started()
    e.plan = {"approved": True, "addressees": ["Главный бухгалтер"]}
    e.state = "working"
    ask = {"kind": "ask", "to": {"role": "addressee", "person": "Аналитик данных", "po_can_answer": False},
           "text": "Какие метрики нужны?", "closes": ["G05"], "expected": "fact"}
    it = e.complete(w.iteration_id, good(next_state="working", directives=[ask]), NOW)
    assert [d["kind"] for d in it["directives"]] == ["approve_plan_change"]
    assert it["directives"][0]["to"]["role"] == "po" and "Аналитик данных" in it["directives"][0]["text"]
    # PO согласился — адресат попал в план
    ack, work = e.submit({"schema_version": "1.0.0", "initiative_id": "ini-0001", "base_iteration": it["iteration_id"],
                          "idempotency_key": "x", "outcomes": [{"directive_id": it["directives"][0]["id"], "result": "answer",
                                                                "by_role": "po", "content": "Да, добавьте"}]}, NOW)
    assert "Аналитик данных" in e.plan["addressees"]


def test_no_questions_to_people_before_the_plan_is_approved():
    e, w = started()
    ask = {"kind": "ask", "to": {"role": "addressee", "person": "Главный бухгалтер", "po_can_answer": False},
           "text": "Какие поля нужны?", "closes": ["G07"], "expected": "fact"}
    it = e.complete(w.iteration_id, good(directives=[ask]), NOW)
    assert not [d for d in it["directives"] if d["to"]["role"] == "addressee"]
    assert "отложено до утверждения плана" in it["summary"]


def test_missing_team_always_gets_clarify_team_first():
    e, _, w = Engine.start(Policy.load(), "ini-0002", {"schema_version": "1.0.0", "goal": "x", "idempotency_key": "k"}, "po", NOW)
    it = e.complete(w.iteration_id, good(next_state="brief", directives=[]), NOW)
    assert it["directives"][0]["kind"] == "clarify_team"


def test_transitions_the_model_cannot_make_are_ignored():
    e, w = started()
    it = e.complete(w.iteration_id, good(next_state="accepted"), NOW)
    assert it["state"] == "goal"   # из «Цели» модель ведёт только в «Бриф»; accepted ставит PO


def test_demo_model_walks_the_whole_lifecycle_through_real_checks():
    """Демо-модель + строгие проверки: бриф → план → проработка → приёмка → принята. Тупиков нет."""
    from bftbox import demo_llm
    e, _, w = Engine.start(Policy.load(), "ini-0001", {"schema_version": "1.0.0", "goal": "Выгрузка заказов в CSV",
                           "brief": "Бухгалтер раз в неделю вручную копирует заказы в таблицу", "team": "team-a", "idempotency_key": "k"}, "po", NOW)
    states, k = [], 0
    while True:
        it = e.complete(w.iteration_id, demo_llm.produce(e.context(w.iteration_id, NOW)), NOW)
        states.append(it["state"])
        k += 1
        outs = [{"directive_id": d["id"], "result": "answer", "by_role": "po",
                 "content": "Утверждаю" if d["kind"] in ("approve_plan", "accept_package") else "Ответ за 2 секунды"} for d in it["directives"]]
        ack, w = e.submit({"schema_version": "1.0.0", "initiative_id": "ini-0001", "base_iteration": it["iteration_id"],
                           "idempotency_key": f"s{k}", "outcomes": outs}, NOW)
        if w is None:
            break
    assert states == ["brief", "plan_approval", "working", "acceptance"] and ack["state"] == "accepted"


def test_red_during_brief_and_plan_does_not_count_as_stuck():
    e, w = started()
    for n in range(4):
        it = e.complete(w.iteration_id, good(next_state="brief", checks=[]), NOW)
        _, w = e.submit({"schema_version": "1.0.0", "initiative_id": "ini-0001", "base_iteration": it["iteration_id"],
                         "idempotency_key": f"b{n}", "outcomes": [], "iterate": True}, NOW)
    assert it["state"] != "needs_po" and not e.red_streak
