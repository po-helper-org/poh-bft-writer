"""Протокол коробки БФТ 1.0.0: версии, ошибки по контракту и проверка сообщений по JSON Schema."""
from __future__ import annotations

import hashlib
import json
import os

import jsonschema

SCHEMA_VERSION = "1.0.0"
SUPPORTED = ["1.0.0"]
TS_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


class BoxError(Exception):
    """Отказ по протоколу: превращается в сообщение Error."""

    def __init__(self, code: str, message: str, **extra):
        super().__init__(message)
        self.code, self.message, self.extra = code, message, extra

    def payload(self) -> dict:
        return {"schema_version": SCHEMA_VERSION, "error": {"code": self.code, "message": self.message, **self.extra}}


def _load_schema() -> dict:
    with open(os.path.join(os.path.dirname(__file__), "protocol.schema.json"), encoding="utf-8") as f:
        return json.load(f)


# читается при импорте: validate() вызывается и из воркфлоу, где песочница Temporal запрещает open()
_SCHEMA = _load_schema()


def _schema() -> dict:
    return _SCHEMA


def validate(def_name: str, obj) -> None:
    """Сообщение должно соответствовать $defs/<def_name>; иначе BoxError(validation)."""
    schema = {"$ref": f"#/$defs/{def_name}", "$defs": _schema()["$defs"]}
    try:
        jsonschema.validate(obj, schema)
    except jsonschema.ValidationError as e:
        where = "/".join(str(p) for p in e.absolute_path) or "тело"
        raise BoxError("validation", f"{where}: {e.message}"[:300]) from None


def check_version(version) -> None:
    """Другая мажорная версия — bad_schema_version; старшая минорная — совместимо."""
    if not isinstance(version, str) or version.split(".")[0] != SCHEMA_VERSION.split(".")[0]:
        raise BoxError("bad_schema_version", f"Коробка понимает {SCHEMA_VERSION.split('.')[0]}.x.",
                       supported_schema_versions=SUPPORTED)


def body_hash(body: dict) -> str:
    """Отпечаток тела запроса без ключа идемпотентности — для сравнения повторов."""
    clean = {k: v for k, v in body.items() if k != "idempotency_key"}
    return hashlib.sha256(json.dumps(clean, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
