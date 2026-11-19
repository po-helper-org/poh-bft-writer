"""Жизненный цикл инициативы БФТ — чистый конечный автомат без сети, времени и модели.

Состояние держит один объект `Engine` на инициативу; Temporal хранит его в процессе воркфлоу, Postgres — только
копия для чтения (get/list/status). Модель вызывается снаружи: engine говорит, когда нужна итерация
(`Work`), и принимает её результат (`complete`). Правила протокола (идемпотентность, conflict, not_ready,
накопление исходов, пауза, reopen) и проверки качества кодом (`quality`) — здесь, а не в модели.
"""
from __future__ import annotations

import copy
import datetime as dt
from dataclasses import dataclass

from . import quality
from .protocol import SCHEMA_VERSION, TS_FORMAT, BoxError, body_hash, check_version, validate

DECISIONS = ("approve_plan", "approve_plan_change", "accept_package", "decide", "clarify_team")
RETRY_AFTER = 60


def ts(t: dt.datetime) -> str:
    return t.astimezone(dt.timezone.utc).strftime(TS_FORMAT)


def parse_ts(s: str) -> dt.datetime:
    return dt.datetime.strptime(s, TS_FORMAT).replace(tzinfo=dt.timezone.utc)


@dataclass
class Work:
    """Итерация, которую нужно подготовить моделью."""
    iteration_id: str
    trigger: str


class Engine:
    def __init__(self, policy: quality.Policy, initiative_id: str, owner: str = ""):
        self.policy = policy
        self.id, self.owner = initiative_id, owner
        self.goal = self.brief = ""
        self.files: list = []
        self.team = None
        self.refs: dict = {}
        self.state = "goal"
        self.paused_from = None
        self.plan = {"approved": False, "addressees": []}
        self.iterations: list = []
        self.proposals: dict = {}       # iteration_id → план, который предложила модель
        self.directives: dict = {}      # выданные и не закрытые указания: id → указание
        self.meta: dict = {}            # id указания → служебное (адресат для approve_plan_change)
        self.outcomes: dict = {}        # исходы текущего круга: directive_id → исход
        self.log: list = []             # закрытые исходы — для контекста модели
        self.inputs: list = []
        self.docs: dict = {}            # kind → {kind,title,content}
        self.version = 0
        self.bump_next = False
        self.checks: list = []
        self.red_streak: dict = {}
        self.idem: dict = {}
        self.feedback: list = []        # что вернул PO при отказе в плане/приёмке
        self._dir_seq = 0

    # ---------- запуск и вызовы ----------

    @classmethod
    def start(cls, policy, initiative_id: str, req: dict, owner: str, now: dt.datetime):
        check_version(req.get("schema_version"))
        validate("StartRequest", req)
        e = cls(policy, initiative_id, owner)
        e.goal, e.brief, e.team = req["goal"], req.get("brief", ""), req.get("team")
        e.refs, e.files = dict(req.get("external_refs") or {}), list(req.get("files") or [])
        it = e._new_iteration("start", now)
        ack = e._ack(it, new=True)
        e.idem[req["idempotency_key"]] = (body_hash(req), ack)
        return e, ack, Work(it["iteration_id"], "start")

    def submit(self, req: dict, now: dt.datetime):
        """Исходы исполнителя. Возвращает (Ack, Work|None)."""
        check_version(req.get("schema_version"))
        validate("SubmitRequest", req)
        replay = self._replay(req)
        if replay:
            return replay, None
        latest = self.iterations[-1]
        if latest["status"] == "preparing":
            raise BoxError("not_ready", f"Итерация {latest['iteration_id']} ещё готовится.",
                           latest_iteration_id=latest["iteration_id"], retry_after_seconds=RETRY_AFTER)
        if req["base_iteration"] != latest["iteration_id"]:
            raise BoxError("conflict", f"base_iteration {req['base_iteration']} — не последняя.",
                           latest_iteration_id=latest["iteration_id"])
        if self.state in ("cancelled", "accepted"):
            raise BoxError("invalid_state", f"submit недопустим в состоянии {self.state}.")
        for o in req["outcomes"]:
            d = self.directives.get(o["directive_id"])
            if not d:
                raise BoxError("validation", f"указания {o['directive_id']} нет среди выданных.")
            if d["kind"] in DECISIONS and o["result"] == "answer" and o.get("by_role") != "po":
                raise BoxError("validation", f"решение по {d['id']} ({d['kind']}) принимает только PO: by_role=po.")
        for o in req["outcomes"]:
            self.outcomes[o["directive_id"]] = {**o, "iteration": latest["number"]}
        if req.get("inputs"):
            self.inputs.append(req["inputs"])
        self.files += [f for f in req.get("files") or []]
        pending = [d for d in self.directives if d not in self.outcomes]
        trigger = "requested" if req.get("iterate") else ("all_outcomes" if not pending else None)
        if self.state == "paused" or trigger is None:
            ack = self._ack(latest, new=False, pending=len(pending))
        else:
            ack, work = self._open_round(trigger, now)
            self._remember(req, ack)
            return ack, work
        self._remember(req, ack)
        return ack, None

    def control(self, req: dict, now: dt.datetime):
        check_version(req.get("schema_version"))
        validate("ControlRequest", req)
        replay = self._replay(req)
        if replay:
            return replay, None
        act, st = req["action"], self.state
        latest = self.iterations[-1]
        work = None
        if act == "pause":
            if st in ("paused", "cancelled", "accepted"):
                raise BoxError("invalid_state", "pause допустим только из активных состояний.")
            self.paused_from, self.state = st, "paused"
            ack = self._ack(latest, new=False)
        elif act == "resume":
            if st != "paused":
                raise BoxError("invalid_state", "resume допустим только из paused.")
            self.state, self.paused_from = self.paused_from, None
            ack = self._ack(latest, new=False)
        elif act == "cancel":
            if st in ("cancelled", "accepted"):
                raise BoxError("invalid_state", "cancel допустим только из незавершённых состояний.")
            self.state, self.paused_from = "cancelled", None
            ack = self._ack(latest, new=False)
        else:  # reopen
            if st not in ("cancelled", "accepted"):
                raise BoxError("invalid_state", "reopen допустим только из cancelled и accepted.")
            self.bump_next = st == "accepted"
            self.state = "working" if self.docs else "brief"
            if req.get("reason"):
                self.inputs.append(f"Доработка: {req['reason']}")
            self.checks = [dict(c) for c in self.checks]
            it = self._new_iteration("control", now)
            ack, work = self._ack(it, new=True), Work(it["iteration_id"], "control")
        self._remember(req, ack)
        return ack, work

    def deadline_tick(self, now: dt.datetime):
        """Истёк срок указания → итерация trigger=deadline (не на паузе и не при готовящейся итерации)."""
        if self.state in ("paused", "cancelled", "accepted") or self.iterations[-1]["status"] == "preparing":
            return None
        late = [d for d in self.directives.values() if d["state"] in ("open", "overdue") and parse_ts(d["due"]) <= now
                and d["id"] not in self.outcomes]
        if not late:
            return None
        for d in late:
            d["state"] = "overdue"
        _, work = self._open_round("deadline", now)
        return work

    def next_deadline(self):
        dues = [d["due"] for d in self.directives.values() if d["state"] in ("open", "overdue")
                and d["id"] not in self.outcomes and self.state not in ("paused", "cancelled", "accepted")]
        return min(dues) if dues else None

    # ---------- результат итерации ----------

    def context(self, iteration_id: str, now: dt.datetime) -> dict:
        """Всё, что видит модель при подготовке итерации."""
        it = self._iteration(iteration_id)
        return {
            "goal": self.goal, "brief": self.brief, "team": self.team, "state": self.state, "trigger": it["trigger"],
            "number": it["number"], "plan": self.plan,
            "files": [{"name": f["name"], "text": f.get("text", "")} for f in self.files if f.get("text")],
            "binary_files": [f["name"] for f in self.files if not f.get("text")],
            "documents": self.docs, "checks": self.checks, "red_streak": self.red_streak,
            "open_directives": [d for d in self.directives.values()],
            "new_outcomes": [self._outcome_view(o) for o in self.log[-50:] if o.get("fresh")],
            "inputs": self.inputs[-20:], "feedback": self.feedback[-5:],
            "checks_catalog": self.policy.checks, "required_sections": list(self.policy.required_sections),
            "now": ts(now),
        }

    def complete(self, iteration_id: str, produced: dict | None, now: dt.datetime, error: str | None = None):
        it = self._iteration(iteration_id)
        if it["status"] != "preparing":
            return it
        if error or not isinstance(produced, dict):
            it.update(status="error", state="needs_po" if self.state not in ("goal",) else "goal",
                      error={"code": "model_failed", "message": f"Модель не ответила после повторов: {error or 'пустой ответ'}"[:300]
                             + " Указания прошлой итерации в силе; повтор — submit(iterate:true).",
                             "retry_after_seconds": 300})
            self.state = it["state"]
            self._unfresh()
            return it
        self._apply(it, produced, now)
        self._unfresh()
        return it

    # ---------- представления ----------

    def get(self, iteration_id: str) -> dict:
        it = copy.deepcopy(self._iteration(iteration_id))
        if self.state == "paused" and it is not None and it["iteration_id"] == self.iterations[-1]["iteration_id"]:
            for d in it.get("directives", []):
                d["state"] = "suspended"
        return it

    def status(self) -> dict:
        latest = self.iterations[-1]
        out = {"schema_version": SCHEMA_VERSION, "initiative_id": self.id, "state": self.state,
               "latest": {"iteration_id": latest["iteration_id"], "number": latest["number"], "status": latest["status"]}}
        nd = self.next_deadline()
        if nd:
            out["next_deadline"] = nd
        return out

    def list_item(self) -> dict:
        item = {"initiative_id": self.id, "goal": self.goal, "state": self.state,
                "latest_iteration_id": self.iterations[-1]["iteration_id"]}
        if self.refs:
            item["external_refs"] = self.refs
        return item

    def snapshot(self) -> dict:
        return {"initiative": {**self.list_item(), "owner": self.owner, "status": self.status(),
                               "team": self.team, "package_version": self.version},
                "iterations": [self.get(i["iteration_id"]) for i in self.iterations[-2:]]}

    # ---------- внутреннее ----------

    def _iteration(self, iteration_id: str) -> dict:
        for it in self.iterations:
            if it["iteration_id"] == iteration_id:
                return it
        raise BoxError("unknown_initiative", f"итерации {iteration_id} нет.")

    def _new_iteration(self, trigger: str, now: dt.datetime) -> dict:
        n = len(self.iterations) + 1
        suffix = self.id.split("-", 1)[-1]
        it = {"schema_version": SCHEMA_VERSION, "initiative_id": self.id, "iteration_id": f"it-{suffix}-{n:04d}",
              "number": n, "status": "preparing", "state": self.state, "trigger": trigger, "created_at": ts(now),
              "goal": self.goal, "team": self.team, "external_refs": self.refs}
        self.iterations.append(it)
        return it

    def _ack(self, it: dict, new: bool, pending: int | None = None) -> dict:
        ack = {"schema_version": SCHEMA_VERSION, "initiative_id": self.id, "iteration_id": it["iteration_id"],
               "status": it["status"], "state": self.state, "new_iteration": new}
        if pending is not None:
            ack["pending_outcomes"] = pending
        return ack

    def _replay(self, req: dict):
        seen = self.idem.get(req["idempotency_key"])
        if not seen:
            return None
        if seen[0] != body_hash(req):
            raise BoxError("idempotency_mismatch", f"Ключ {req['idempotency_key']} уже был с другим телом.")
        return seen[1]

    def _remember(self, req: dict, ack: dict):
        self.idem[req["idempotency_key"]] = (body_hash(req), ack)

    def _open_round(self, trigger: str, now: dt.datetime):
        """Исходы собраны (или истёк срок): применить решения PO и начать итерацию."""
        accepted = self._ingest_outcomes()
        if accepted:
            return self._accept()
        it = self._new_iteration(trigger, now)
        return self._ack(it, new=True), Work(it["iteration_id"], trigger)

    def _ingest_outcomes(self) -> bool:
        accepted = False
        for did, o in list(self.outcomes.items()):
            d = self.directives.pop(did)
            meta = self.meta.pop(did, {})
            po_answer = o["result"] == "answer" and o.get("by_role") == "po"
            ok = po_answer and quality.is_approval(o.get("content", ""))
            if d["kind"] == "clarify_team" and po_answer:
                self.team = (o["content"].strip().splitlines() or [""])[0][:80] or self.team
            elif d["kind"] == "approve_plan" and po_answer:
                if ok:
                    self.plan = {"approved": True, "addressees": self.proposals.get(meta.get("iteration"), self.plan["addressees"])}
                else:
                    self.feedback.append(f"План не утверждён: {o['content']}")
            elif d["kind"] == "approve_plan_change" and po_answer:
                if ok and meta.get("person"):
                    self.plan["addressees"] = list({*self.plan["addressees"], meta["person"]})
                elif not ok:
                    self.feedback.append(f"Адресат {meta.get('person')} не добавлен: {o['content']}")
            elif d["kind"] == "accept_package" and po_answer:
                if ok:
                    accepted = True
                else:
                    self.feedback.append(f"Пакет возвращён: {o['content']}")
            self.log.append({**o, "kind": d["kind"], "text": d["text"], "fresh": True})
        self.outcomes = {}
        return accepted

    def _accept(self):
        """Приёмка PO — решение без модели: состояние accepted, итерации не создаются, пакет и светофор те же."""
        self.state = "accepted"
        self.directives, self.meta = {}, {}
        self._unfresh()
        return self._ack(self.iterations[-1], new=False), None

    def _unfresh(self):
        for o in self.log:
            o["fresh"] = False

    @staticmethod
    def _outcome_view(o: dict) -> dict:
        return {"directive_id": o["directive_id"], "kind": o.get("kind"), "text": o.get("text"), "result": o["result"],
                "by_role": o.get("by_role"), "content": o.get("content", "")}

    def _package(self) -> dict:
        return {"version": max(self.version, 1), "documents": [self.docs[k] for k in quality.DOC_KINDS if k in self.docs]}

    def _new_dir_id(self) -> str:
        self._dir_seq += 1
        return f"dir-{self._dir_seq:03d}"

    def _apply(self, it: dict, produced: dict, now: dt.datetime):
        """Результат модели → итерация: документы, светофор, указания и состояние — после проверок кодом."""
        notes = []
        # документы пакета
        changed = False
        for d in produced.get("documents") or []:
            if isinstance(d, dict) and d.get("kind") in quality.DOC_KINDS and str(d.get("content") or "").strip():
                new = {"kind": d["kind"], "title": str(d.get("title") or d["kind"])[:200], "format": "markdown",
                       "content": str(d["content"])}
                changed |= self.docs.get(d["kind"], {}).get("content") != new["content"]
                self.docs[d["kind"]] = new
        if not self.version:
            self.version = 1
        elif self.bump_next:
            self.version, self.bump_next = self.version + 1, False
        elif changed:
            self.version += 1
        # светофор
        corpus = "\n".join([self.goal, self.brief, *self.inputs, *(f.get("text", "") for f in self.files),
                            *(o.get("content", "") for o in self.log), *(d["content"] for d in self.docs.values())]).lower()
        checks, check_notes = quality.normalize_checks(self.policy, produced.get("checks"), self.docs, corpus)
        notes += check_notes
        for c in checks:   # «застряла» считаем только с проработки: на брифе и плане красное — норма
            if self.state in ("working", "needs_po", "acceptance"):
                self.red_streak[c["id"]] = self.red_streak.get(c["id"], 0) + 1 if c["status"] == "red" else 0
        self.checks = checks
        # предложенный моделью план — запоминаем за итерацией (утвердит PO)
        plan = produced.get("plan") or {}
        proposed = [str(a.get("person") if isinstance(a, dict) else a) for a in plan.get("addressees") or []]
        if proposed:
            self.proposals[it["iteration_id"]] = proposed
        # указания: невыполненные переходят дальше, модель может снять лишние и добавить новые
        carried = self._carry(now, it["trigger"], set(produced.get("drop") or []))
        fresh = self._make_directives(produced.get("directives") or [], it, now, notes)
        self.directives = {d["id"]: d for d in [*carried, *fresh]}
        # состояние
        nxt = produced.get("next_state") if produced.get("next_state") in quality.TRANSITIONS.get(self.state, ()) else self.state
        if nxt in ("working", "needs_po") and not self.directives and quality.all_green(checks) and self.plan["approved"]:
            nxt = "acceptance"   # всё зелёное, указаний нет, плана держаться не за что — дальше только приёмка PO
        if nxt == "acceptance":
            blockers = [d for d in self.directives.values() if d["kind"] != "accept_package"]
            lacking = quality.missing_sections(self.policy, self.docs) if self.policy.strict else []
            if not quality.all_green(checks) or blockers or lacking or not self.plan["approved"] and self.policy.strict:
                nxt = "working"
                notes.append("приёмка отложена: светофор не зелёный или остались указания"
                             + (f" (нет разделов: {', '.join(lacking)})" if lacking else ""))
        stuck = [c for c in checks if self.red_streak.get(c["id"], 0) >= self.policy.stuck_after]
        if stuck and nxt in ("working", "needs_po"):
            nxt = "needs_po"
            if not any(d["kind"] == "decide" and set(d["closes"]) & {c["id"] for c in stuck} for d in self.directives.values()):
                c = stuck[0]
                self._add(self._direct("decide", "po", None, True, f"Проверка «{c['title']}» красная {self.red_streak[c['id']]} итераций подряд. "
                                       "Решите, как закрыть пробел, или сузьте границы.", [c["id"]], "decision", 24, now))
        if nxt == "acceptance":
            self.directives = {}
            self._add(self._direct("accept_package", "po", None, True, "Принять пакет БФТ или вернуть с замечаниями.", [], "decision", 24, now))
        if nxt == "working" and not self.plan["approved"] and self.state != "working" and not self.directives:
            nxt = self.state
        if it["trigger"] == "start" or self.team is None:
            if self.team is None and not any(d["kind"] == "clarify_team" for d in self.directives.values()) and nxt in ("goal", "brief"):
                self._add(self._direct("clarify_team", "po", None, True, "Какая команда ведёт инициативу?", ["G04"], "decision", 24, now,
                                       blocks="Без команды не выбрать шаблон БФТ."))
        self.state = nxt
        summary = str(produced.get("summary") or "").strip() or "Итерация подготовлена."
        if notes:
            summary += " Код понизил или отложил: " + "; ".join(notes) + "."
        it.update(status="ready", state=self.state, summary=summary, package=self._package(), checks=checks,
                  directives=[dict(d) for d in self.directives.values()], team=self.team)

    def _add(self, d: dict):
        self.directives[d["id"]] = d

    def _direct(self, kind, role, person, po_can, text, closes, expected, hours, now, group=None, blocks=None):
        d = {"id": self._new_dir_id(), "kind": kind, "to": {"role": role, "po_can_answer": bool(po_can)},
             "text": text, "closes": list(closes), "expected": expected, "due": ts(now + dt.timedelta(hours=hours)), "state": "open"}
        if person:
            d["to"]["person"] = person
        if group:
            d["group"] = group
        if blocks:
            d["blocks"] = blocks
        return d

    def _carry(self, now, trigger, dropped) -> list:
        out = []
        for d in self.directives.values():
            if d["id"] in dropped:
                continue
            d = dict(d)
            if trigger == "deadline" and d["state"] == "overdue":
                d.update(attempt=d.get("attempt", 1) + 1, state="open", due=ts(now + dt.timedelta(hours=24)))
            out.append(d)
        return out

    def _make_directives(self, produced: list, it: dict, now: dt.datetime, notes: list) -> list:
        out, by_text = [], {d["text"] for d in self.directives.values()}
        for p in produced:
            if not isinstance(p, dict) or not str(p.get("text") or "").strip():
                continue
            kind = p.get("kind") if p.get("kind") in ("ask", "collect", "decide", "approve_plan", "approve_plan_change",
                                                      "clarify_team") else "ask"
            to = p.get("to") or {}
            role = to.get("role") if to.get("role") in ("po", "addressee", "executor") else "po"
            person, text = to.get("person"), str(p["text"]).strip()
            if text in by_text:
                continue
            hours = max(1, min(int(p.get("due_in_hours") or 24), 24 * 14))
            closes = [c for c in p.get("closes") or [] if c in self.policy.by_id()]
            expected = p.get("expected") if p.get("expected") in ("fact", "decision", "document") else "fact"
            if role == "addressee" and (not self.plan["approved"] or person not in self.plan["addressees"]):
                if not self.plan["approved"]:
                    notes.append(f"указание адресату «{person}» отложено до утверждения плана")
                    continue
                d = self._direct("approve_plan_change", "po", None, True,
                                 f"Добавить в план адресата «{person}»: {text}", closes, "decision", 24, now)
                self.meta[d["id"]] = {"person": person}
                out.append(d)
                continue
            d = self._direct(kind, role, person, to.get("po_can_answer"), text, closes, expected, hours,
                             now, group=p.get("group"), blocks=p.get("blocks"))
            if kind == "approve_plan":
                self.meta[d["id"]] = {"iteration": it["iteration_id"]}
            out.append(d)
        return out
