"""Т9: проекция конвейера (ADR-0005). Чистые функции без ввода-вывода.

Проверяются три факта: маппинг всех состояний коробки на четыре стадии
конвейера (+боковые), устойчивость к неизвестному состоянию (новая версия
коробки не ломает чтение старой) и вывод ролей ожидания из открытых указаний.
"""
import pytest

from bftbox.stage import CONVEYOR, STAGE_OF, STAGE_TITLES, stage_of, waiting_for


def test_all_box_states_covered():
    """Каждое значение enum InitiativeState схемы отображается, боковые — сами на себя."""
    schema_states = ["goal", "brief", "plan_approval", "working",
                     "acceptance", "accepted", "paused", "needs_po", "cancelled"]
    assert set(schema_states) == set(STAGE_OF), "появилось состояние без стадии — правь STAGE_OF"
    for s in schema_states:
        assert stage_of(s)


def test_conveyor_order_and_titles():
    assert CONVEYOR == ("request", "drafting", "verifying", "validated")
    for st in CONVEYOR:
        assert st in STAGE_TITLES, f"у стадии {st} нет человеческой подписи"


@pytest.mark.parametrize("state,stage", [
    ("goal", "request"),
    ("brief", "drafting"),
    ("plan_approval", "drafting"),
    ("working", "drafting"),
    ("acceptance", "verifying"),
    ("needs_po", "verifying"),
    ("accepted", "validated"),
    ("paused", "paused"),
    ("cancelled", "cancelled"),
])
def test_stage_mapping(state, stage):
    assert stage_of(state) == stage


def test_unknown_state_passthrough():
    """Неизвестное состояние читается как есть — чтение старой коробки новой не падает."""
    assert stage_of("some_future_state") == "some_future_state"


def directive(role, state="open"):
    return {"id": "d1", "to": {"role": role}, "state": state}


def test_waiting_for_roles_dedup_and_order():
    it = {"directives": [directive("addressee"), directive("po"), directive("addressee")]}
    assert waiting_for(it) == ["addressee", "po"]


def test_waiting_for_skips_closed_and_suspended():
    it = {"directives": [directive("po", "closed"), directive("executor", "suspended"),
                         directive("po", "overdue")]}
    assert waiting_for(it) == ["po"]  # overdue всё ещё ждут; closed/suspended — нет


def test_waiting_for_empty():
    assert waiting_for(None) == []
    assert waiting_for({}) == []
    assert waiting_for({"directives": []}) == []
