#!/usr/bin/env python3
"""Схемы как код: разбор и проверка блоков ```seq``` и ```idef0``` карты инициативы.

LLM пишет короткий текст схемы, а не SVG и не таблицу: проверка и рисунок — статичные функции.
Грамматика — `resources/diagram_dsl.md`. Тот же разбор с теми же кодами и сообщениями живёт
в `diagram_kit.js` (редактор в карточке процесса); совпадение проверяет `test-bft-blueprint.sh`.

  ОШИБКИ                                         ПРЕДУПРЕЖДЕНИЯ
  DG000  нет блока или заголовок не тот          DG020  больше 12 шагов
  DG001  seq: строка не разобрана                DG021  больше 6 участников
  DG002  seq: описание повторено или пусто       DG022  сообщение длиннее 70 знаков
  DG003  seq: ветка не открыта, вложена, не      DG023  объявленный участник не участвует
         закрыта или без условия                 DG024  ответ без вызова
  DG004  seq: участник объявлен дважды или       DG025  нет описания процесса
         с другим видом                          DG026  описание длиннее 240 знаков
  DG005  seq: пустое сообщение                   DG040  выход функции никуда не идёт
  DG006  seq: ветка без шагов                    DG041  механизм функции не из механизмов блока
  DG007  seq: неизвестный участник               DG042  подпись длиннее 60 знаков
  DG008  seq: нет ни одного шага
  DG030  idef0: строка не разобрана
  DG031  idef0: ключ повторён
  DG032  idef0: пустое поле блока
  DG033  idef0: функции A1…An по порядку, от 2 до 6, с названием
  DG034  idef0: у функции нет управления или выхода
  DG035  idef0: вход или управление функции ниоткуда не приходит
  DG036  idef0: выход блока не выдаёт ни одна функция

Использование (проверка одного блока, например ответа ИИ):
    python3 diagram_dsl.py БЛОК.txt [--parts УЧАСТНИКИ.json] [--json]
Код выхода: 0 — ошибок нет; 1 — ошибки; 2 — файл не прочитан. Только стандартная библиотека.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

KINDS = {"человек": "p", "интерфейс": "i", "система": "s", "внешний": "x"}
MAX_STEPS = 12
MAX_PARTS = 6
MAX_MSG = 70
MAX_DESC = 240
MAX_LABEL = 60
MIN_FN, MAX_FN = 2, 6

FENCE_RE = re.compile(r"^```\s*(seq|idef0)\b\s*(.*?)\s*$")
FENCE_END = re.compile(r"^```\s*$")
SEQ_ID = re.compile(r"^П\d+$")
IDEF_ID = re.compile(r"^\d{1,2}\.\d{1,2}$")
PID = r"[A-Za-z][A-Za-z0-9]{0,7}"
MSG_RE = re.compile(rf"^({PID})\s*(-->|->)\s*({PID})\s*:\s*(.*)$")
NOMSG_RE = re.compile(rf"^({PID})\s*(-->|->)\s*({PID})\s*$")
DECL_RE = re.compile(rf"^(человек|интерфейс|система|внешний)\s+({PID})\s*:\s*(.*)$")
IF_RE = re.compile(r"^если(?=[\s:]|$)[\s:]*(.*)$")
ELSE_RE = re.compile(r"^иначе(?=[\s:]|$)[\s:]*(.*)$")
END_RE = re.compile(r"^конец$")
DESC_RE = re.compile(r"^описание\s*:\s*(.*)$")
KEY_RE = re.compile(r"^(функция|входы?|управление|регуляторы|выходы?|механизмы?)\s*:\s*(.*)$")
FN_RE = re.compile(r"^A(\d+)\s*[:.]?\s*(.*)$")
KEY_OF = {"функция": "fn", "вход": "in", "входы": "in", "управление": "ctl", "регуляторы": "ctl",
          "выход": "out", "выходы": "out", "механизм": "mech", "механизмы": "mech"}
KEY_NAME = {"fn": "функция", "in": "вход", "ctl": "управление", "out": "выход", "mech": "механизм"}


def issue(out: list, line: int, level: str, code: str, msg: str) -> None:
    out.append({"line": line, "level": level, "code": code, "msg": msg})


def split_values(raw: str) -> list[str]:
    """Значения через «;», точка с запятой внутри [квадратных скобок] не делит."""
    vals, cur, depth = [], "", 0
    for ch in raw:
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth = max(0, depth - 1)
        if ch == ";" and depth == 0:
            vals.append(cur)
            cur = ""
        else:
            cur += ch
    vals.append(cur)
    return [v.strip() for v in vals if v.strip() and v.strip() not in ("—", "-", "–")]


def norm_label(s: str) -> str:
    s = re.sub(r"\s+", " ", s.lower().replace("ё", "е")).strip()
    return s.rstrip(".,;:").strip()


def extract(text: str) -> dict:
    """Первый блок ```seq ID``` или ```idef0 ID``` в тексте (ответ ИИ может быть с пояснениями).

    {kind, id, body: [строки], offset: номер строки заголовка в тексте, issues}
    """
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    for i, ln in enumerate(lines):
        m = FENCE_RE.match(ln.strip())
        if not m:
            continue
        kind, bid = m.group(1), m.group(2).strip()
        body, j = [], i + 1
        while j < len(lines) and not FENCE_END.match(lines[j].strip()):
            body.append(lines[j])
            j += 1
        res = {"kind": kind, "id": bid, "body": body, "offset": i + 1, "issues": []}
        if j >= len(lines):
            issue(res["issues"], len(body), "ERROR", "DG000", "блок не закрыт строкой ```")
        ok = SEQ_ID.match(bid) if kind == "seq" else IDEF_ID.match(bid)
        if not ok:
            issue(res["issues"], 0, "ERROR", "DG000",
                  f"заголовок блока: ```seq П3``` — ID процесса, ```idef0 1.2``` — ID задачи, а не «{bid}»")
        return res
    return {"kind": "", "id": "", "body": [], "offset": 0,
            "issues": [{"line": 0, "level": "ERROR", "code": "DG000",
                        "msg": "нет блока ```seq П3 … ``` или ```idef0 1.2 … ```"}]}


# --------------------------------------------------------------------------------- seq ---
def parse_seq(body: list[str], parts: dict) -> dict:
    """Шаги sequence-схемы. `parts` — участники карты {ID: [имя, вид]}."""
    iss: list = []
    local: dict = {}
    decl_line: dict = {}
    steps: list = []
    desc, desc_line = "", 0
    br, br_line, group_n = "", 0, 0   # ветка: "" | "если: …" | "иначе: …"
    last = 0
    for n, raw in enumerate(body, start=1):
        ln = raw.strip()
        if not ln or ln.startswith("//"):
            continue
        last = n
        m = DESC_RE.match(ln)
        if m:
            if not m.group(1).strip():
                issue(iss, n, "ERROR", "DG002", "пустое описание")
            elif desc_line:
                issue(iss, n, "ERROR", "DG002", f"описание уже есть (строка {desc_line}) — одно на процесс")
            else:
                desc, desc_line = m.group(1).strip(), n
                if len(desc) > MAX_DESC:
                    issue(iss, n, "WARN", "DG026", f"описание {len(desc)} знаков (больше {MAX_DESC}) — суть в двух фразах")
            continue
        m = DECL_RE.match(ln)
        if m:
            kind, pid, name = KINDS[m.group(1)], m.group(2), m.group(3).strip()
            if not name:
                issue(iss, n, "ERROR", "DG004", f"участник {pid}: нет имени")
            elif pid in local:
                issue(iss, n, "ERROR", "DG004", f"участник {pid} уже объявлен (строка {decl_line[pid]})")
            elif pid in parts and parts[pid][1] != kind:
                issue(iss, n, "ERROR", "DG004", f"участник {pid} в карте — другого вида; новый — другой ID")
            else:
                local[pid] = [name, kind]
                decl_line[pid] = n
            continue
        m = IF_RE.match(ln)
        if m:
            if br:
                issue(iss, n, "ERROR", "DG003", f"ветка внутри ветки (открыта в строке {br_line}) — закройте «конец» или разделите процесс")
            elif not m.group(1).strip():
                issue(iss, n, "ERROR", "DG003", "«если» без условия")
            else:
                br, br_line, group_n = "если: " + m.group(1).strip(), n, 0
            continue
        m = ELSE_RE.match(ln)
        if m:
            if not br:
                issue(iss, n, "ERROR", "DG003", "«иначе» без «если»")
            else:
                if group_n == 0:
                    issue(iss, n, "ERROR", "DG006", f"ветка «{br}» без шагов")
                br, br_line, group_n = "иначе: " + (m.group(1).strip() or "в остальных случаях"), n, 0
            continue
        if END_RE.match(ln):
            if not br:
                issue(iss, n, "ERROR", "DG003", "«конец» без «если»")
            else:
                if group_n == 0:
                    issue(iss, n, "ERROR", "DG006", f"ветка «{br}» без шагов")
                br, group_n = "", 0
            continue
        m = MSG_RE.match(ln)
        if m:
            src, arrow, dst, text = m.group(1), m.group(2), m.group(3), m.group(4).strip()
            bad = [x for x in dict.fromkeys((src, dst)) if x not in parts and x not in local]
            for x in bad:
                issue(iss, n, "ERROR", "DG007", f"участника {x} нет — ID из «Участников» или объявление «система {x}: Имя»")
            if not text:
                issue(iss, n, "ERROR", "DG005", "пустое сообщение после «:»")
            if bad or not text:
                continue
            if len(text) > MAX_MSG:
                issue(iss, n, "WARN", "DG022", f"сообщение {len(text)} знаков (больше {MAX_MSG})")
            kind = "ответ" if arrow == "-->" else "вызов"
            if kind == "ответ" and src != dst and not any(s["src"] == dst and s["dst"] == src and s["kind"] == "вызов" for s in steps):
                issue(iss, n, "WARN", "DG024", f"ответ {src} --> {dst} без вызова {dst} -> {src} — вызов «->», ответ «-->»")
            steps.append({"branch": br, "src": src, "dst": dst, "text": text, "kind": kind, "line": n})
            group_n += 1
            continue
        if NOMSG_RE.match(ln):
            issue(iss, n, "ERROR", "DG005", "нет сообщения — «A -> B: что передаётся»")
            continue
        issue(iss, n, "ERROR", "DG001", "строка не разобрана: «A -> B: сообщение», «B --> A: ответ», "
                                        "«если …», «иначе …», «конец», «описание: …» или «система ID: Имя»")
    if br:
        issue(iss, last or 1, "ERROR", "DG003", f"ветка из строки {br_line} не закрыта — «конец»")
    if not steps:
        issue(iss, last or 1, "ERROR", "DG008", "нет ни одного шага «A -> B: сообщение»")
    used = list(dict.fromkeys(x for s in steps for x in (s["src"], s["dst"])))
    for pid, n in decl_line.items():
        if pid not in used:
            issue(iss, n, "WARN", "DG023", f"участник {pid} объявлен, но не участвует в шагах")
    if len(steps) > MAX_STEPS:
        issue(iss, steps[MAX_STEPS]["line"], "WARN", "DG020", f"{len(steps)} шагов (больше {MAX_STEPS}) — схема перестаёт читаться, раздели процесс")
    if len(used) > MAX_PARTS:
        issue(iss, 1, "WARN", "DG021", f"{len(used)} участников (больше {MAX_PARTS}) — раздели процесс")
    if steps and not desc:
        issue(iss, 1, "WARN", "DG025", "нет «описание: …» — суть процесса одной-двумя фразами")
    return {"kind": "seq", "desc": desc, "parts": local, "steps": steps, "issues": sort_issues(iss)}


# ------------------------------------------------------------------------------- idef0 ---
def _box(line: int = 0) -> dict:
    return {"in": [], "ctl": [], "out": [], "mech": [], "line": line, "keys": {}}


def parse_idef(body: list[str]) -> dict:
    """Функция задачи (A0) и, по желанию, её декомпозиция на функции A1…An."""
    iss: list = []
    top = _box(1)
    fn, fn_line = "", 0
    kids: list = []
    cur = top
    last = 0
    for n, raw in enumerate(body, start=1):
        ln = raw.strip()
        if not ln or ln.startswith("//"):
            continue
        last = n
        m = KEY_RE.match(ln)
        if m:
            key = KEY_OF[m.group(1)]
            if key == "fn":
                if cur is not top or fn_line:
                    issue(iss, n, "ERROR", "DG031", "«функция:» — одна, до функций A1…An")
                else:
                    fn, fn_line = m.group(2).strip(), n
                continue
            if key in cur["keys"]:
                issue(iss, n, "ERROR", "DG031", f"«{KEY_NAME[key]}» уже есть (строка {cur['keys'][key]}) — значения через «;» в одной строке")
                continue
            cur["keys"][key] = n
            cur[key] = split_values(m.group(2))
            for v in cur[key]:
                if len(v) > MAX_LABEL:
                    issue(iss, n, "WARN", "DG042", f"подпись {len(v)} знаков (больше {MAX_LABEL}): «{v[:30]}…»")
            continue
        m = FN_RE.match(ln)
        if m:
            k, name = int(m.group(1)), m.group(2).strip()
            if k != len(kids) + 1:
                issue(iss, n, "ERROR", "DG033", f"функция A{k}: номера по порядку — ожидается A{len(kids) + 1}")
            if not name:
                issue(iss, n, "ERROR", "DG033", f"функция A{k} без названия")
            cur = _box(n)
            cur["n"], cur["i"], cur["name"] = k, len(kids), name
            kids.append(cur)
            continue
        issue(iss, n, "ERROR", "DG030", "строка не разобрана: «вход: …», «управление: …», «выход: …», "
                                        "«механизм: …», «функция: …» или «A1 Название функции»")
    for key in ("in", "ctl", "out", "mech"):
        if not top[key]:
            issue(iss, top["keys"].get(key, 1), "ERROR", "DG032", f"пустое поле «{KEY_NAME[key]}» блока")
    if kids and not (MIN_FN <= len(kids) <= MAX_FN):
        issue(iss, kids[0]["line"], "ERROR", "DG033", f"функций {len(kids)} — декомпозиция от {MIN_FN} до {MAX_FN}")
    if kids:
        boundary = {norm_label(v) for v in top["in"] + top["ctl"]}
        made = {}
        for b in kids:
            for v in b["out"]:
                made.setdefault(norm_label(v), b["i"])
        mechs = {norm_label(v) for v in top["mech"]}
        for b in kids:
            for key in ("ctl", "out"):
                if not b[key]:
                    issue(iss, b["line"], "ERROR", "DG034", f"у A{b['n']} нет «{KEY_NAME[key]}» — в IDEF0 у каждой функции есть управление и выход")
            for key in ("in", "ctl"):
                for v in b[key]:
                    lab = norm_label(v)
                    if lab not in boundary and (lab not in made or made[lab] == b["i"]):
                        issue(iss, b["keys"][key], "ERROR", "DG035",
                              f"«{v}» у A{b['n']} ниоткуда не приходит — это вход или управление блока либо выход другой функции")
            for v in b["mech"]:
                if norm_label(v) not in mechs:
                    issue(iss, b["keys"]["mech"], "WARN", "DG041", f"механизм «{v}» у A{b['n']} — не из механизмов блока")
        top_out = {norm_label(v) for v in top["out"]}
        for v in top["out"]:
            if norm_label(v) not in made:
                issue(iss, top["keys"].get("out", 1), "ERROR", "DG036", f"выход блока «{v}» не выдаёт ни одна функция")
        consumed = {norm_label(v) for b in kids for v in b["in"] + b["ctl"]}
        for b in kids:
            for v in b["out"]:
                lab = norm_label(v)
                if lab not in top_out and lab not in consumed:
                    issue(iss, b["keys"]["out"], "WARN", "DG040", f"выход «{v}» у A{b['n']} никуда не идёт")
    clean = lambda b: {k: b[k] for k in ("in", "ctl", "out", "mech")}  # noqa: E731
    return {"kind": "idef0", "fn": fn, **clean(top),
            "children": [{"n": b["n"], "name": b["name"], **clean(b), "line": b["line"]} for b in kids],
            "issues": sort_issues(iss)}


def sort_issues(iss: list) -> list:
    return sorted(iss, key=lambda i: (i["line"], i["code"]))


def check_text(text: str, parts: dict) -> dict:
    """Блок из произвольного текста: извлечь, разобрать, вернуть модель с проблемами."""
    ex = extract(text)
    if not ex["kind"]:
        return {"kind": "", "id": "", "issues": ex["issues"]}
    res = parse_seq(ex["body"], parts) if ex["kind"] == "seq" else parse_idef(ex["body"])
    res["id"] = ex["id"]
    res["issues"] = sort_issues(ex["issues"] + res["issues"])
    return res


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("file", help="текст с блоком ```seq …``` или ```idef0 …```; «-» — stdin")
    ap.add_argument("--parts", type=Path, help="участники карты JSON {ID: [имя, вид]}")
    ap.add_argument("--json", action="store_true", help="модель и проблемы в JSON")
    args = ap.parse_args()
    try:
        text = sys.stdin.read() if args.file == "-" else Path(args.file).read_text(encoding="utf-8")
        parts = json.loads(args.parts.read_text(encoding="utf-8")) if args.parts else {}
    except (OSError, ValueError) as e:
        print(f"{args.file}: не прочитан: {e}", file=sys.stderr)
        return 2
    res = check_text(text, parts)
    if args.json:
        print(json.dumps(res, ensure_ascii=False, sort_keys=True))
    else:
        off = extract(text)["offset"]
        for i in res["issues"]:
            print(f"{args.file}:{off + i['line']}: {i['level']} {i['code']} {i['msg']}")
    return 1 if any(i["level"] == "ERROR" for i in res["issues"]) else 0


if __name__ == "__main__":
    sys.exit(main())
