"""Итерация коробки → markdown для PO (get(iteration_id, format=md)). Перенесено из контракта."""

STATE = {"goal": "Цель", "brief": "Бриф", "plan_approval": "На утверждении плана", "working": "Проработка",
         "acceptance": "На приёмке", "accepted": "Принята", "paused": "Пауза", "needs_po": "Нужен PO",
         "cancelled": "Отменена"}
LIGHT = {"red": "🔴", "yellow": "🟡", "green": "🟢"}
WHO = {"po": "PO", "addressee": "адресат", "executor": "исполнитель"}
EXPECTED = {"fact": "факт", "decision": "решение", "document": "документ"}


def render(it: dict) -> str:
    out = [f"# Итерация {it['number']} · {STATE[it['state']]}", "",
           f"Цель: {it.get('goal', '—')} · команда: {it.get('team') or 'не указана'} · статус: {it['status']}"]
    if it["status"] == "preparing":
        return "\n".join(out + ["", "Итерация готовится."]) + "\n"
    if it["status"] == "error":
        e = it["error"]
        return "\n".join(out + ["", f"Ошибка `{e['code']}`: {e['message']}"]) + "\n"
    out += ["", it["summary"], "", f"## Светофор (пакет v{it['package']['version']})", ""]
    out += [f"- {LIGHT[c['status']]} {c['title']} — {c['evidence']}" for c in it["checks"]]
    out += ["", "## Указания", ""]
    groups: dict = {}
    for d in it["directives"]:
        groups.setdefault(d.get("group") or d["id"], []).append(d)
    for items in groups.values():
        head = items[0]["to"]
        who = head.get("person") or WHO[head["role"]]
        if len(items) > 1:
            out.append(f"**{who}** — одним обращением:")
        for d in items:
            tags = [EXPECTED[d["expected"]], f"до {d['due'][:10]}"]
            if d["to"]["po_can_answer"] and d["to"]["role"] != "po":
                tags.append("может ответить PO")
            if d["state"] != "open":
                tags.append(d["state"])
            if d.get("attempt", 1) > 1:
                tags.append(f"попытка {d['attempt']}")
            prefix = "  - " if len(items) > 1 else f"- **{who}**: "
            line = f"{prefix}`{d['id']}` {d['text']} ({', '.join(tags)})"
            if d["closes"]:
                line += f" → закрывает {', '.join(d['closes'])}"
            out.append(line)
            if d.get("blocks"):
                out.append(f"  - не закрыть — {d['blocks']}")
    return "\n".join(out) + "\n"
