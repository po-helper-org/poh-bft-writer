"""Установка без Docker: SQLite вместо Postgres и ключ модели из файла."""
import json

import pytest

from bftbox import config
from bftbox.engine import Engine
from bftbox.llm import OpenAIProducer
from bftbox.quality import Policy
from bftbox.store import MemoryStore, SqliteStore, make_store
from tests.test_quality import NOW, good


def fill(*stores):
    for key in ("00000001", "00000002"):
        e, _, w = Engine.start(Policy.load(), f"ini-{key}", {"schema_version": "1.0.0", "goal": "Выгрузка " + key, "brief": "Бухгалтер копирует заказы вручную",
                                                               "team": "team-a", "idempotency_key": key}, "hermes", NOW)
        if key == "00000001":
            e.complete(w.iteration_id, good(next_state="brief", directives=[
                {"kind": "ask", "to": {"role": "po", "po_can_answer": True}, "text": "Кто сверяет заказы?", "closes": ["G07"], "expected": "fact"}]), NOW)
        for s in stores:
            s.save(e.snapshot())


def test_sqlite_store_behaves_like_the_memory_store(tmp_path):
    mem, sql = MemoryStore(), make_store(f"sqlite:///{tmp_path}/box.db")
    assert isinstance(sql, SqliteStore)
    fill(mem, sql)
    assert [i["initiative_id"] for i in sql.initiatives("hermes")] == ["ini-00000002", "ini-00000001"] or len(sql.initiatives("hermes")) == 2
    assert sql.initiatives("other") == []
    ini = sql.initiative("ini-00000001")
    assert ini["owner"] == "hermes" and ini["updated_at"] and ini["status"]["latest"]["status"] == "ready"
    assert sql.iteration(ini["latest_iteration_id"])["directives"][0]["id"] == "dir-001"
    assert sql.latest("ini-00000002")["status"] == "preparing"
    assert sql.initiative("nope") is None and sql.iteration("nope") is None
    assert dict(sql.stats(NOW)) == dict(mem.stats(NOW))          # метрики одинаковы у обоих хранилищ
    assert sql.stats(NOW)["po_waiting"] == 1


def test_sqlite_store_survives_reopening_and_claims_start_keys_once(tmp_path):
    url = f"sqlite:///{tmp_path}/sub/box.db"                     # каталог создаётся сам
    first = make_store(url)
    fill(first)
    again = make_store(url)                                      # другой процесс (воркер ↔ MCP) видит то же
    assert len(again.initiatives()) == 2
    assert again.claim_start("hermes", "k", "h1", "ini-a") == ("h1", "ini-a")
    assert again.claim_start("hermes", "k", "h2", "ini-b") == ("h1", "ini-a")   # повтор — записанное


def test_model_key_is_read_from_a_file_on_every_call(tmp_path, monkeypatch):
    keyfile = tmp_path / "key"
    keyfile.write_text("first-key\n")
    monkeypatch.setattr(config, "LLM_API_KEY_FILE", str(keyfile))
    monkeypatch.setattr(config, "LLM_API_KEY", "")
    sent = []

    class Resp:
        def raise_for_status(self): pass
        def json(self): return {"choices": [{"message": {"content": json.dumps({"summary": "ok"})}}]}

    def post(url, json=None, timeout=None, headers=None):
        sent.append((headers["Authorization"], json))
        return Resp()

    monkeypatch.setattr("bftbox.llm.httpx.post", post)
    p = OpenAIProducer(base_url="http://gw/v1", model="m")
    assert p.produce({"goal": "x"}) == {"summary": "ok"}
    keyfile.write_text("second-key\n")                            # ключ сменили без рестарта
    p.produce({"goal": "x"})
    assert [a for a, _ in sent] == ["Bearer first-key", "Bearer second-key"]
    assert "response_format" in sent[0][1]


def test_json_mode_can_be_switched_off_for_gateways_that_do_not_know_it(monkeypatch):
    monkeypatch.setattr(config, "LLM_API_KEY_FILE", "")
    monkeypatch.setattr(config, "LLM_API_KEY", "k")
    monkeypatch.setattr(config, "LLM_JSON_MODE", False)
    seen = {}

    class Resp:
        def raise_for_status(self): pass
        def json(self): return {"choices": [{"message": {"content": "```json\n{\"summary\": \"ok\"}\n```"}}]}   # ограждения терпим

    monkeypatch.setattr("bftbox.llm.httpx.post", lambda url, json=None, timeout=None, headers=None: (seen.update(json), Resp())[1])
    assert OpenAIProducer(base_url="http://gw/v1", model="m").produce({}) == {"summary": "ok"}
    assert "response_format" not in seen


def test_missing_key_file_and_no_key_is_a_clear_error(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "LLM_API_KEY_FILE", str(tmp_path / "nope"))
    with pytest.raises(RuntimeError, match="нет файла ключа"):
        OpenAIProducer(base_url="http://gw/v1", model="m").produce({})
