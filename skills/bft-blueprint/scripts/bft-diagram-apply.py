#!/usr/bin/env python3
"""bft-diagram-apply — проверить блок схемы и вставить его в `<epic_slug>-map.md`.

Агент (или PO из карточки процесса) пишет только блок ```seq П3``` или ```idef0 1.2``` —
не переписывает карту целиком. Скрипт детерминированно:
  1) достаёт первый блок из текста (ответ ИИ может быть с пояснениями);
  2) проверяет синтаксис и смысл тем же кодом, что линтер и редактор на странице (DG0xx),
     с участниками карты; процесс или задача должны быть в карте;
  3) заменяет блок с тем же ID в разделе «Схемы» или «IDEF0» (нет — добавляет в конец раздела);
  4) разбирает карту заново и пишет файл, только если в ней не появилось ошибок.

Использование:
    python3 bft-diagram-apply.py <epic>-map.md БЛОК.txt|- [--check]
    --check — только проверить блок, карту не трогать
Коды выхода: 0 — вставлен (или проверен); 1 — ошибки в блоке или в карте после вставки; 2 — файл не прочитан.
Дальше — bft-map-render.py, чтобы страница показала новую схему.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import bft_map as bm  # noqa: E402
import diagram_dsl as dd  # noqa: E402

SECTION = {"seq": "Схемы", "idef0": "IDEF0"}


def block_text(ex: dict) -> list[str]:
    return [f"```{ex['kind']} {ex['id']}"] + [ln.rstrip() for ln in ex["body"]] + ["```"]


def splice(lines: list[str], kind: str, bid: str, block: list[str]) -> list[str] | None:
    """Строки карты с блоком на месте прежнего (или в конце раздела); None — раздела нет."""
    name = SECTION[kind]
    start = next((i for i, ln in enumerate(lines) if ln.strip() == f"## {name}"), None)
    if start is None:
        return None
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
    i = start + 1
    while i < end:
        m = dd.FENCE_RE.match(lines[i].strip())
        if m:
            j = i + 1
            while j < end and not dd.FENCE_END.match(lines[j].strip()):
                j += 1
            same = m.group(1) == kind and (bm.norm_proc(m.group(2)) or m.group(2).strip()) == (bm.norm_proc(bid) or bid)
            if same:
                return lines[:i] + block + lines[j + 1:]
            i = j + 1
            continue
        i += 1
    tail = end
    while tail > start + 1 and not lines[tail - 1].strip():
        tail -= 1
    return lines[:tail] + [""] + block + [""] + lines[end:]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("map", type=Path)
    ap.add_argument("block", help="текст с блоком; «-» — stdin")
    ap.add_argument("--check", action="store_true", help="только проверить блок")
    args = ap.parse_args()
    try:
        text = sys.stdin.read() if args.block == "-" else Path(args.block).read_text(encoding="utf-8")
        mp = bm.parse(args.map)
    except OSError as e:
        print(f"не прочитан: {e}", file=sys.stderr)
        return 2

    ex = dd.extract(text)
    parts = {p.id: [p.name, p.kind] for p in mp.parts}
    res = dd.check_text(text, parts)
    issues = list(res["issues"])
    if ex["kind"] == "seq" and not ex["issues"] and not mp.process(bm.norm_proc(ex["id"])):
        issues.append({"line": 0, "level": "ERROR", "code": "MP010", "msg": f"процесса {ex['id']} нет в «Процессах» карты"})
    if ex["kind"] == "idef0" and not ex["issues"] and not mp.task(ex["id"]):
        issues.append({"line": 0, "level": "ERROR", "code": "MP007", "msg": f"задачи {ex['id']} нет в «Задачах» карты"})
    label = f"{ex['kind']} {ex['id']}".strip() or "блок"
    for i in issues:
        print(f"{label}:{i['line']}: {i['level']} {i['code']} {i['msg']}")
    errors = [i for i in issues if i["level"] == "ERROR"]
    if errors:
        print(f"diagram-apply: {label} — ошибок {len(errors)}, карта не изменена")
        return 1
    if args.check:
        print(f"diagram-apply: {label} — ошибок нет, предупреждений {len(issues)}")
        return 0

    lines = args.map.read_text(encoding="utf-8").split("\n")
    new = splice(lines, ex["kind"], ex["id"], block_text(ex))
    if new is None:
        print(f"diagram-apply: в карте нет раздела «{SECTION[ex['kind']]}»")
        return 1
    tmp = args.map.with_name(f".{args.map.name}.apply")
    tmp.write_text("\n".join(new), encoding="utf-8")
    try:
        after = bm.parse(tmp)
        before = {(i.code, i.msg) for i in mp.errors}
        fresh = [i for i in after.errors if (i.code, i.msg) not in before]
        if fresh:
            for i in fresh:
                print(f"{args.map}:{i.line}: {i.level} {i.code} {i.msg}")
            print("diagram-apply: после вставки в карте ошибки — карта не изменена")
            return 1
        tmp.replace(args.map)
    finally:
        if tmp.exists():
            tmp.unlink()
    print(f"diagram-apply: {label} → {args.map} (предупреждений {len(issues)}); дальше — bft-map-render.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
