"""Проекция конвейера БФТ на состояния коробки (ADR-0005, harness/docs).

Конвейер — домен продукта: запрос → сбор → верификация → validated. Состояния
коробки — механика воркфлоу (goal → brief → plan_approval → working →
acceptance → accepted, боковые paused/needs_po/cancelled). Проекция
**производная**: контракт 1.0.0 не меняется, 28 эталонов проходят без правок;
`stage` и `waiting_for` добавляются только в ответы чтения (list/board/card).

Решение зафиксировано реализацией Т9: переименование enum сломало бы контракт
ради красоты, а вызывающим (плагин, Трекер) нужен домен, не механика.
"""
from __future__ import annotations

# Порядок значений конвейера — порядок колонок PO-доски.
CONVEYOR = ("request", "drafting", "verifying", "validated")

STAGE_OF = {
    "goal": "request",          # запрос: цель зафиксирована, пакет ещё не собирается
    "brief": "drafting",        # сбор: бриф → план → проработка
    "plan_approval": "drafting",
    "working": "drafting",
    "acceptance": "verifying",  # верификация: пакет на приёмке, диалоги с людьми
    "needs_po": "verifying",    # верификация: ждёт решения PO (красные итерации)
    "accepted": "validated",    # validated: чек-лист ADR-0005 закрыт
    "paused": "paused",         # вне конвейера: заморожена решением PO
    "cancelled": "cancelled",   # вне конвейера: терминальна
}

# Читаемые машиной синонимы для людей: плагин показывает русские подписи.
STAGE_TITLES = {
    "request": "запрос",
    "drafting": "сбор",
    "verifying": "верификация",
    "validated": "validated",
    "paused": "пауза",
    "cancelled": "отменена",
}


def stage_of(state: str) -> str:
    """Конвейерная стадия состояния коробки. Неизвестное состояние проходит
    насквозь: коробка новой версии не должна ломать чтение старой."""
    return STAGE_OF.get(state, state)


def waiting_for(latest_iteration: dict | None) -> list[str]:
    """Роли с открытыми указаниями: po | addressee | executor.

    Сотрудник и заказчик — оба «адресаты из плана»; различает их контакт
    инициативы на стороне UI и Трекера. Коробка честно отдаёт роль указания,
    порядок стабильный, дубликаты убраны. suspended-указания (пауза) не ждут.
    """
    roles: list[str] = []
    for d in (latest_iteration or {}).get("directives") or []:
        if d.get("state") in ("open", "overdue"):
            role = (d.get("to") or {}).get("role")
            if role and role not in roles:
                roles.append(role)
    return roles
