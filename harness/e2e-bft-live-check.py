#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Проверка живого прогона /bft (ADR-0016): опирался ли он на память и источники.

  python3 harness/e2e-bft-live-check.py <каталог прогона>

Каталог собирает harness/e2e-bft-live.sh: live-run.json и live-{fast,deep}.md от
теста, cortex-health.json, artifacts/ — файлы заявки из тома портала
(context_map.md, sources.md, deep.json, primary.json, intake.json).

Обязательные проверки (провал — код 1):
  память   Кортекс читает память bft-creator (не демо, не шаблон), карта контекста
           заявки непустая: системы IT-ландшафта и хотя бы один термин или прошлый БФТ;
  источники разведка по Jira/Confluence дала находки (sources.md);
  опора    полный БФТ использует знание из памяти, которого нет в словах заказчика:
           не меньше двух имён систем/доменов/терминов из карты контекста;
  качество полный БФТ собран, последняя попытка без ERROR линтера и проверок портала.
Отчёт — live-report.md в том же каталоге.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

ANCHOR = re.compile(r"`((?:sys|int|proc|dom|team|term|bft)-[a-z0-9-]+)`")


def read(path: pathlib.Path) -> str:
    return path.read_text(encoding="utf-8") if path.is_file() else ""


def map_sections(md: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    current = None
    for line in md.splitlines():
        if line.startswith("## "):
            current = line[3:].strip()
            out[current] = []
        elif current and line.startswith("- "):
            out[current].append(line)
    return out


def names(lines: list[str]) -> list[str]:
    """Имена узлов карты: «**Имя — описание**» → «Имя»; термины — сам термин."""
    out = []
    for line in lines:
        m = re.match(r"- \*\*(.+?)\*\*", line)
        if not m:
            continue
        title = re.sub(r"^БФТ:\s*", "", m.group(1))
        name = re.split(r"\s+[—–-]\s+|:\s", title, maxsplit=1)[0].strip()
        if len(name) >= 2:
            out.append(name)
    return out


def mentioned(text: str, name: str) -> bool:
    low = text.lower().replace("ё", "е")
    key = name.lower().replace("ё", "е")
    if re.fullmatch(r"[a-zа-я0-9.]{2,5}", key):
        return re.search(rf"(?<![\w]){re.escape(key)}(?![\w])", low) is not None
    stems = [w[:6] for w in re.findall(r"[\w.]+", key) if len(w) >= 3]
    return bool(stems) and all(s in low for s in stems)


def main(run_dir: str) -> int:
    root = pathlib.Path(run_dir)
    run = json.loads(read(root / "live-run.json") or "{}")
    art = root / "artifacts"
    health = json.loads(read(root / "cortex-health.json") or "{}")
    context = read(art / "context_map.md")
    sources = read(art / "sources.md")
    deep_md = read(root / "live-deep.md") or read(art / f"{run.get('slug', '')}.md")
    state = json.loads(read(art / "deep.json") or "{}")
    # Слова заказчика: обращение, поля документа fast и intake. В primary.json есть и ответ
    # Кортекса (brief, where) — это память, а не заказчик: их не берём.
    primary = json.loads(read(art / "primary.json") or "{}")
    customer = {k: primary.get(k) for k in ("args", "howToDemo", "checklist")}
    words = "\n".join([run.get("request", ""), json.dumps(customer, ensure_ascii=False), read(art / "intake.json")])

    checks: list[tuple[str, bool, str]] = []
    def check(name: str, ok: bool, detail: str) -> None:
        checks.append((name, ok, detail))

    # 1. Память bft-creator.
    check("память: Кортекс читает настоящую память", health.get("demo") is False and int(health.get("nodes") or 0) >= 50,
          f"demo={health.get('demo')}, узлов {health.get('nodes')}, vault {health.get('vault')}")
    header = context.splitlines()[2] if len(context.splitlines()) > 2 else ""
    check("память: карта контекста из bft-creator", "bft-creator" in header and "демо" not in header, header[:160] or "нет context_map.md")
    sections = map_sections(context)
    anchors = sorted(set(ANCHOR.findall(context)))
    landscape = sections.get("IT-ландшафт: где и как проверять", [])
    terms = sections.get("Термины", [])
    precedents = sections.get("Прошлые БФТ по теме", [])
    empty = "Память по этой теме ничего не знает" in context
    check("память: карта непустая", not empty and len(anchors) >= 3, f"якорей {len(anchors)}: {', '.join(anchors[:14])}")
    check("память: системы IT-ландшафта", len([l for l in landscape if "Память этого не знает" not in l]) >= 1,
          f"{len(landscape)}: {'; '.join(names(landscape))[:200]}")
    check("память: термины или прошлые БФТ", len(terms) + len(precedents) >= 1,
          f"терминов {len(terms)}, прошлых БФТ {len(precedents)}: {'; '.join(names(precedents))[:160]}")

    # 2. Источники.
    findings = re.findall(r"(?m)^## (?!Отсеяно)(.+)$", sources)
    check("источники: находки Jira/Confluence", len(findings) >= 1, f"{len(findings)}: {'; '.join(findings[:5])[:220]}")

    # 3. Опора полного БФТ на память: знание, которого нет в словах заказчика.
    candidates = []
    for title in ("IT-ландшафт: где и как проверять", "Что известно о процессах", "Домены и контрагенты", "Термины", "О ком идёт речь"):
        candidates += names(sections.get(title, []))
    candidates = list(dict.fromkeys(candidates))
    new_knowledge = [n for n in candidates if not mentioned(words, n)]
    used = [n for n in new_knowledge if mentioned(deep_md, n)]
    # Где проверять и владельцы из карты — фрагменты строк IT-ландшафта и «Владельцев систем».
    details = []
    for line in landscape:
        tail = line.split("** — ", 1)[1] if "** — " in line else ""
        details += [d.strip(" .") for d in re.split(r";|\. Владелец: ", tail.split(" `")[0]) if len(d.strip()) >= 12]
    details += [l.split(" → ", 1)[1].strip() for l in sections.get("Владельцы систем", []) if " → " in l]
    details = [d for d in dict.fromkeys(details) if d.lower() not in words.lower()]
    found_details = [d for d in details if d.lower() in deep_md.lower()]
    marks = len(re.findall(r"(?i)по памяти организации", deep_md))
    evidence = len(used) + len(found_details) + marks
    check("опора: полный БФТ использует знание из памяти", marks >= 1 and evidence >= 3,
          f"пометок «по памяти организации» {marks}; новых имён из карты {len(used)} ({', '.join(used[:6])}); "
          f"мест проверки и владельцев из карты {len(found_details)} ({'; '.join(found_details[:4])[:200]})")

    # 4. Качество сборки.
    quality = state.get("quality") or {}
    lint = (quality.get("lintErrorsByAttempt") or [None])[-1]
    canon = (quality.get("checkErrorsByAttempt") or [None])[-1]
    check("качество: полный БФТ собран", state.get("stage") == "ready", f"stage={state.get('stage')}, попыток {quality.get('attempts')}")
    check("качество: без ERROR в последней попытке", lint in (0, None) and canon in (0, None), f"линтер {lint}, проверки портала {canon}")

    ok = all(passed for _, passed, _ in checks)
    lines = [f"# Живой прогон /bft — {run.get('slug', '?')}", "",
             f"Время прогона: {run.get('seconds', '?')} с. Итог: {'✅ пройден' if ok else '❌ не пройден'}.", "",
             "| Проверка | Итог | Подробности |", "|---|---|---|"]
    lines += [f"| {name} | {'✅' if passed else '❌'} | {detail.replace('|', '/')} |" for name, passed, detail in checks]
    metrics = {k: v for k, v in quality.items() if not isinstance(v, (list, dict))}
    if metrics:
        lines += ["", "Метрики качества: " + ", ".join(f"{k}={v}" for k, v in metrics.items())]
    report = "\n".join(lines) + "\n"
    (root / "live-report.md").write_text(report, encoding="utf-8")
    print(report)
    return 0 if ok else 1


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1]))
