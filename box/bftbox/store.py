"""Хранилище для чтения: итерации и инициативы. Истина — состояние воркфлоу в Temporal; сюда пишет активность
`persist` после каждого изменения, отсюда читают get/status/list и страница /bft, не трогая воркфлоу."""
from __future__ import annotations

import json
import threading

SCHEMA_SQL = """
create table if not exists initiatives (
  initiative_id text primary key, owner text not null, goal text not null, state text not null, team text,
  latest_iteration_id text not null, external_refs jsonb not null default '{}', status jsonb not null,
  package_version int not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists iterations (
  iteration_id text primary key, initiative_id text not null references initiatives(initiative_id),
  number int not null, body jsonb not null, updated_at timestamptz not null default now());
create index if not exists iterations_initiative on iterations(initiative_id, number);
create table if not exists start_keys (
  owner text not null, key text not null, body_hash text not null, initiative_id text not null,
  primary key (owner, key));
"""


def compute_stats(initiatives: dict, iterations: dict, now=None) -> dict:
    """Агрегаты для метрик из инициатив и итераций в памяти (для MemoryStore и SqliteStore; у Postgres — те же в SQL)."""
    import collections
    import datetime as dt
    now = now or dt.datetime.now(dt.timezone.utc)
    out = {"initiatives": collections.Counter(i["state"] for i in initiatives.values()),
           "iterations": collections.Counter((it["trigger"], it["status"]) for it in iterations.values()),
           "checks": collections.Counter(), "directives": collections.Counter(), "downgraded": 0}
    prep = [it for it in iterations.values() if it["status"] == "preparing"]
    out["preparing"] = len(prep)
    out["oldest_preparing_seconds"] = max([(now - dt.datetime.strptime(it["created_at"], "%Y-%m-%dT%H:%M:%SZ")
                                            .replace(tzinfo=dt.timezone.utc)).total_seconds() for it in prep], default=0)
    out["po_waiting"] = 0
    for i in initiatives.values():
        latest = iterations.get(i["latest_iteration_id"]) or {}
        if i["state"] not in ("accepted", "cancelled", "paused") and any(
                d["to"]["role"] == "po" and d["state"] in ("open", "overdue") for d in latest.get("directives") or []):
            out["po_waiting"] += 1   # у инициативы есть указание к PO, на которое он ещё не ответил
        for c in latest.get("checks") or []:
            out["checks"][(c["id"], c["status"])] += 1
            out["downgraded"] += "[код:" in c["evidence"]
        for d in (latest.get("directives") or []) if i["state"] not in ("accepted", "cancelled") else []:
            out["directives"][(d["kind"], d["state"])] += 1   # у принятой и отменённой указаний уже не ждут
    return out


class MemoryStore:
    """Для тестов и локального прогона без Postgres."""

    def __init__(self):
        self.ini, self.its, self.keys = {}, {}, {}
        self.lock = threading.Lock()

    def save(self, snap: dict):
        with self.lock:
            i = snap["initiative"]
            self.ini[i["initiative_id"]] = i
            for it in snap["iterations"]:
                self.its[it["iteration_id"]] = it

    def iteration(self, iteration_id):
        return self.its.get(iteration_id)

    def initiative(self, initiative_id):
        return self.ini.get(initiative_id)

    def initiatives(self, owner=None):
        return [i for i in self.ini.values() if owner is None or i["owner"] == owner]

    def latest(self, initiative_id):
        ini = self.ini.get(initiative_id)
        return self.its.get(ini["latest_iteration_id"]) if ini else None

    def stats(self, now=None):
        return compute_stats(self.ini, self.its, now)

    def claim_start(self, owner, key, body_hash, initiative_id):
        """Первый вызов с ключом записывается, повтор получает записанное (хэш тела, id инициативы)."""
        with self.lock:
            return self.keys.setdefault((owner, key), (body_hash, initiative_id))


class PgStore:
    def __init__(self, dsn: str):
        import psycopg
        self.psycopg, self.dsn = psycopg, dsn

    def _conn(self):
        return self.psycopg.connect(self.dsn, autocommit=True)

    def init(self):
        with self._conn() as c:
            c.execute(SCHEMA_SQL)

    def save(self, snap: dict):
        i = snap["initiative"]
        with self._conn() as c, c.transaction():
            c.execute("""insert into initiatives (initiative_id, owner, goal, state, team, latest_iteration_id, external_refs, status, package_version)
                         values (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                         on conflict (initiative_id) do update set state=excluded.state, team=excluded.team,
                           latest_iteration_id=excluded.latest_iteration_id, status=excluded.status,
                           package_version=excluded.package_version, updated_at=now()""",
                      (i["initiative_id"], i["owner"], i["goal"], i["state"], i.get("team"), i["latest_iteration_id"],
                       json.dumps(i.get("external_refs") or {}), json.dumps(i["status"]), i.get("package_version", 0)))
            for it in snap["iterations"]:
                c.execute("""insert into iterations (iteration_id, initiative_id, number, body) values (%s,%s,%s,%s)
                             on conflict (iteration_id) do update set body=excluded.body, updated_at=now()""",
                          (it["iteration_id"], i["initiative_id"], it["number"], json.dumps(it)))

    def iteration(self, iteration_id):
        with self._conn() as c:
            row = c.execute("select body from iterations where iteration_id=%s", (iteration_id,)).fetchone()
        return row[0] if row else None

    _COLS = "initiative_id, owner, goal, state, team, latest_iteration_id, external_refs, status, package_version, created_at, updated_at"

    def _row(self, r):
        keys = [k.strip() for k in self._COLS.split(",")]
        d = dict(zip(keys, r))
        d["created_at"], d["updated_at"] = d["created_at"].isoformat(), d["updated_at"].isoformat()
        return d

    def initiative(self, initiative_id):
        with self._conn() as c:
            row = c.execute(f"select {self._COLS} from initiatives where initiative_id=%s", (initiative_id,)).fetchone()
        return self._row(row) if row else None

    def initiatives(self, owner=None):
        with self._conn() as c:
            rows = c.execute(f"select {self._COLS} from initiatives" + (" where owner=%s" if owner else "")
                             + " order by updated_at desc", (owner,) if owner else ()).fetchall()
        return [self._row(r) for r in rows]

    def latest(self, initiative_id):
        ini = self.initiative(initiative_id)
        return self.iteration(ini["latest_iteration_id"]) if ini else None

    def claim_start(self, owner, key, body_hash, initiative_id):
        """Атомарно: первый вызов с ключом записывается, повтор получает записанное."""
        with self._conn() as c:
            c.execute("insert into start_keys (owner, key, body_hash, initiative_id) values (%s,%s,%s,%s) "
                      "on conflict do nothing", (owner, key, body_hash, initiative_id))
            row = c.execute("select body_hash, initiative_id from start_keys where owner=%s and key=%s", (owner, key)).fetchone()
        return tuple(row)

    LATEST = "from iterations it join initiatives i on it.iteration_id = i.latest_iteration_id"

    def stats(self):
        """Агрегаты для метрик: одним соединением, без текстов и id — только счётчики по перечислимым значениям."""
        with self._conn() as c:
            ini = dict(c.execute("select state, count(*) from initiatives group by state").fetchall())
            its = {(t, st): n for t, st, n in c.execute(
                "select body->>'trigger', body->>'status', count(*) from iterations group by 1, 2").fetchall()}
            prep, oldest = c.execute(
                "select count(*), coalesce(extract(epoch from now() - min((body->>'created_at')::timestamptz)), 0) "
                "from iterations where body->>'status' = 'preparing'").fetchone()
            checks = {(k, st): n for k, st, n in c.execute(
                f"select ck->>'id', ck->>'status', count(*) {self.LATEST}, "
                "jsonb_array_elements(coalesce(it.body->'checks', '[]'::jsonb)) ck group by 1, 2").fetchall()}
            down = c.execute(
                f"select count(*) {self.LATEST}, jsonb_array_elements(coalesce(it.body->'checks', '[]'::jsonb)) ck "
                "where ck->>'evidence' like '%[код:%'").fetchone()[0]
            po_waiting = c.execute(
                f"select count(distinct i.initiative_id) {self.LATEST}, "
                "jsonb_array_elements(coalesce(it.body->'directives', '[]'::jsonb)) d "
                "where d->'to'->>'role' = 'po' and d->>'state' in ('open', 'overdue') "
                "and i.state not in ('accepted', 'cancelled', 'paused')").fetchone()[0]
            dirs = {(k, st): n for k, st, n in c.execute(
                f"select d->>'kind', d->>'state', count(*) {self.LATEST}, "
                "jsonb_array_elements(coalesce(it.body->'directives', '[]'::jsonb)) d "
                "where i.state not in ('accepted', 'cancelled') group by 1, 2").fetchall()}
        return {"initiatives": ini, "iterations": its, "preparing": prep, "oldest_preparing_seconds": float(oldest),
                "checks": checks, "downgraded": down, "directives": dirs, "po_waiting": po_waiting}


class SqliteStore:
    """Хранилище для чтения на одном файле SQLite: установка без Postgres и Docker (воркер пишет, MCP читает — WAL).
    Данные малы (инициативы и их итерации), поэтому агрегаты метрик считаются в Python теми же правилами, что у MemoryStore."""

    def __init__(self, path: str):
        import os
        self.path = os.path.expanduser(path)

    def _c(self):
        import sqlite3
        c = sqlite3.connect(self.path, timeout=30)
        c.row_factory = sqlite3.Row
        return c

    def init(self):
        import os
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        with self._c() as c:
            c.execute("pragma journal_mode=wal")
            c.executescript("""
                create table if not exists initiatives (initiative_id text primary key, owner text not null, body text not null,
                    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')), updated_at text not null);
                create table if not exists iterations (iteration_id text primary key, initiative_id text not null, number int not null, body text not null);
                create index if not exists iterations_initiative on iterations(initiative_id, number);
                create table if not exists start_keys (owner text not null, key text not null, body_hash text not null,
                    initiative_id text not null, primary key (owner, key));""")

    def save(self, snap: dict):
        i = snap["initiative"]
        with self._c() as c:
            c.execute("insert into initiatives (initiative_id, owner, body, updated_at) values (?,?,?,strftime('%Y-%m-%dT%H:%M:%SZ','now')) "
                      "on conflict(initiative_id) do update set body=excluded.body, updated_at=excluded.updated_at",
                      (i["initiative_id"], i["owner"], json.dumps(i, ensure_ascii=False)))
            for it in snap["iterations"]:
                c.execute("insert into iterations (iteration_id, initiative_id, number, body) values (?,?,?,?) "
                          "on conflict(iteration_id) do update set body=excluded.body",
                          (it["iteration_id"], i["initiative_id"], it["number"], json.dumps(it, ensure_ascii=False)))

    @staticmethod
    def _ini(row) -> dict:
        d = json.loads(row["body"])
        d["created_at"], d["updated_at"] = row["created_at"], row["updated_at"]
        return d

    def iteration(self, iteration_id):
        with self._c() as c:
            row = c.execute("select body from iterations where iteration_id=?", (iteration_id,)).fetchone()
        return json.loads(row["body"]) if row else None

    def initiative(self, initiative_id):
        with self._c() as c:
            row = c.execute("select * from initiatives where initiative_id=?", (initiative_id,)).fetchone()
        return self._ini(row) if row else None

    def initiatives(self, owner=None):
        with self._c() as c:
            rows = c.execute("select * from initiatives" + (" where owner=?" if owner else "") + " order by updated_at desc, rowid desc",
                             (owner,) if owner else ()).fetchall()
        return [self._ini(r) for r in rows]

    def latest(self, initiative_id):
        ini = self.initiative(initiative_id)
        return self.iteration(ini["latest_iteration_id"]) if ini else None

    def claim_start(self, owner, key, body_hash, initiative_id):
        with self._c() as c:
            c.execute("insert or ignore into start_keys values (?,?,?,?)", (owner, key, body_hash, initiative_id))
            row = c.execute("select body_hash, initiative_id from start_keys where owner=? and key=?", (owner, key)).fetchone()
        return tuple(row)

    def stats(self, now=None):
        with self._c() as c:
            ini = {r["initiative_id"]: json.loads(r["body"]) for r in c.execute("select initiative_id, body from initiatives")}
            its = {r["iteration_id"]: json.loads(r["body"]) for r in c.execute("select iteration_id, body from iterations")}
        return compute_stats(ini, its, now)


def make_store(url: str):
    """DATABASE_URL: sqlite:////абсолютный/путь.db — файл SQLite; иначе postgresql://… — Postgres. Возвращает готовое хранилище."""
    store = SqliteStore(url.split("sqlite:///", 1)[1]) if url.startswith("sqlite:") else PgStore(url)
    store.init()
    return store
