#!/usr/bin/env python3
"""bft-map-render — страница карты инициативы из `<epic_slug>-map.md` и его истории.

Собирает `<epic_slug>-map.html` рядом с документом: шаги пути слева направо, «Что видят»
(экраны истории), «Что делаем» (задачи команд с фильтром по команде), «Как это работает»
(Frontstage, Backstage, Support). Клик по кадру — требования к экрану для дизайнера (screens/<ID>.md: вкладки Product, Design,
Functions, заметки в markdown, картинки крупно), без требований — шаги этапа; по задаче — IDEF0 и вопросы;
по процессу — что до и после, было → станет, что требуется, описание и sequence-схема, IDEF0,
редактор схем как кода с проверкой (`diagram_kit.js` — тот же разбор, что `diagram_dsl.py`) и промпты для ИИ.
Один файл без CDN: стили и скрипты (`page_kit.js`, `diagram_kit.js`, `map_page.js`, `map_page.css`) — внутри.

Документ с ошибками (карты или истории) не рисуется: код 1, файлов нет.

Использование:
    python3 bft-map-render.py <epic>-map.md [--out-dir КАТАЛОГ]
"""
from __future__ import annotations

import argparse
import html
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import bft_map as bm  # noqa: E402
import bft_story as bs  # noqa: E402
import bft_screens as bsn  # noqa: E402

PAGE = """<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title_tag}</title>
<style>
{css}</style></head>
<body>
<h1 class="ptitle">{h1}</h1>
<div class="fab"><button class="burger" id="burger" aria-label="Меню карты" aria-expanded="false" aria-controls="menu"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11"/></svg><span class="bdot" id="bdot"></span></button><span id="fchip"></span></div>
<div class="mscrim"></div>
<nav class="menu" id="menu" aria-label="Меню карты"><div class="mtop"><div><span class="draft{status_cls}">{status}</span><h1>{h1}</h1></div><button class="x" data-menu="close" aria-label="Закрыть">×</button></div>
<button class="play" id="play">▶ Рассказать историю</button>
<div class="mlist"><span id="blk"></span>
<button class="mi" data-guide="help"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h4.5A1.5 1.5 0 0 1 8 4.5V14a1.5 1.5 0 0 0-1.5-1.5H2zM14 3H9.5A1.5 1.5 0 0 0 8 4.5V14a1.5 1.5 0 0 1 1.5-1.5H14z"/></svg>Инструкции</button>
<button class="mi" data-guide="legend"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2.5" width="4" height="4" rx="1"/><path d="M8.5 4.5H14"/><circle cx="4" cy="11.5" r="2"/><path d="M8.5 11.5H14"/></svg>Легенда</button></div>
<div class="mlab">Команды — показать работу одной</div><div class="teams" id="teams"></div></nav>
<section class="hero" id="hero" aria-label="Что видят люди — путь слева направо"></section>
<div class="wrap" id="work"><div id="grid"></div></div>
<div class="mstack" id="mstack"></div>
<div class="scrim"></div><aside class="side" id="side" aria-label="Подробности"></aside><div class="zoombox" id="lb" hidden></div>
<div class="show" id="show" role="dialog" aria-label="История по шагам"><div class="sbar"><div class="whos"></div><button class="x" aria-label="Закрыть">×</button></div>
<div class="stage"></div><div class="snav"><button class="prev">← Назад</button><button class="next">Дальше →</button></div></div>
<script type="application/json" id="map-data">{data}</script>
<script>
{kit}</script>
<script>
{dkit}</script>
<script>
{js}</script>
</body></html>
"""


def model(mp: bm.Map) -> dict:
    st = mp.story
    cols = [s.id for s in st.stages] + [bm.FINAL]
    persona = {p.id: p for p in st.personas}

    # «Что видят»: по карточке на персонажа и этап; итог — карточки «стало»
    seen = []
    for p in st.personas:
        for ci, sid in enumerate(cols):
            if sid == bm.FINAL:
                fin = next((s for s in st.steps_of(p.id) if s.kind == "final"), None)
                if fin:
                    big = p.after.split("·")[0].strip()
                    seen.append({"key": f"{p.id}:{sid}", "persona": p.id, "col": ci, "final": True,
                                 "big": "" if big in bs.EMPTY else big, "title": fin.title,
                                 "steps": [step_json(fin)]})
                continue
            steps = [s for s in st.steps_of(p.id) if s.kind == "step" and s.stage_from == sid]
            if steps:
                seen.append({"key": f"{p.id}:{sid}", "persona": p.id, "col": ci, "final": False,
                             "steps": [step_json(s) for s in steps]})

    # «История» для слайдов — все шаги, как на странице истории
    story = []
    stage_name = {s.id: s.name for s in st.stages}
    for p in st.personas:
        n = 0
        for s in st.steps_of(p.id):
            if s.kind in ("step", "band"):
                n += 1
                label = f"Шаг {n} · {stage_name.get(s.stage_from, '')}"
            else:
                label = "Знакомьтесь" if s.kind == "intro" else "И с тех пор"
            big = (p.before if s.kind == "intro" else p.after if s.kind == "final" else "").split("·")[0].strip()
            story.append({"persona": p.id, "label": label, "title": s.title, "text": s.text, "was": s.was,
                          "screens": s.screens, "big": "" if big in bs.EMPTY else big})

    idef = {i.task: i for i in mp.idef}
    tasks = []
    for t in mp.tasks:
        i = idef.get(t.id)
        tasks.append({"id": t.id, "stage": t.stage, "team": t.team, "cand": t.candidates, "text": t.text,
                      "why": t.why, "reqs": t.reqs, "status": t.status,
                      "idef": {"fn": i.fn, "in": i.inputs, "ctl": i.controls, "out": i.outputs, "mech": i.mechanisms,
                               "children": i.children, "src": i.src} if i else None})
    procs = []
    for p in mp.processes:
        procs.append({"id": p.id, "task": p.task, "stage": p.stage, "layer": p.layer, "text": p.text,
                      "before": p.before, "after": p.after, "source": p.source,
                      "desc": p.desc, "parts": p.parts, "src": p.src,
                      "steps": [{"branch": s.branch, "src": s.src, "dst": s.dst, "text": s.text, "kind": s.kind}
                                for s in mp.steps if s.process == p.id],
                      "criteria": [{"text": c.text, "source": c.source, "state": c.state}
                                   for c in mp.criteria if c.process == p.id]})
    teams = [{"id": t.id, "name": t.name} for t in mp.teams]
    return {
        "epic": mp.meta.get("epic_slug", ""), "title": mp.title,
        "stages": [{"id": s.id, "name": s.name, "when": s.when} for s in st.stages],
        "personas": [{"id": p.id, "name": persona[p.id].name, "lane": p.lane} for p in st.personas],
        "seen": seen, "story": story,
        "screens": {sc.id: {"contour": sc.contour, "device": sc.device, "view": sc.view, "el": sc.elements} for sc in st.screens},
        "notes": {sid: bsn.page_md(doc) for sid, doc in sorted(mp.screens.items())},
        "briefs": {tid: {k: v[1] for k, v in doc.sections.items()} for tid, doc in sorted(mp.briefs.items())},
        "storyQuestions": [{"id": q.id, "to": q.to, "text": q.text, "where": q.where} for q in st.questions if q.open],
        "teams": teams, "tasks": tasks, "processes": procs,
        "parts": {p.id: [p.name, p.kind] for p in mp.parts},
        "links": [{"src": ln.src, "dst": ln.dst, "what": ln.what} for ln in mp.links],
        "questions": [{"id": q.id, "to": q.to, "text": q.text, "where": q.where, "kind": q.kind,
                       "open": q.open, "answer": q.answer} for q in mp.questions],
    }


def step_json(s: bs.Step) -> dict:
    return {"id": s.id, "title": s.title, "text": s.text, "was": s.was, "screens": s.screens, "source": s.source}


def render(mp: bm.Map) -> str:
    data = json.dumps(model(mp), ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    status = mp.meta.get("status", "")
    return PAGE.format(
        title_tag=html.escape(f"Карта · {mp.meta.get('epic_slug', '')}"),
        h1=html.escape(mp.title.split(":", 1)[-1].strip() if ":" in mp.title else mp.title),
        status=html.escape(status), status_cls=" ok" if status.lower() == "согласован" else "",
        css=(HERE / "map_page.css").read_text(encoding="utf-8"),
        kit=(HERE / "page_kit.js").read_text(encoding="utf-8"),
        dkit=(HERE / "diagram_kit.js").read_text(encoding="utf-8"),
        js=(HERE / "map_page.js").read_text(encoding="utf-8"),
        data=data,
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("file", type=Path)
    ap.add_argument("--out-dir", type=Path, help="куда писать .html (по умолчанию — рядом с документом)")
    args = ap.parse_args()
    try:
        mp = bm.parse(args.file)
    except OSError as e:
        print(f"{args.file}: не прочитан: {e}", file=sys.stderr)
        return 2
    if mp.errors or mp.story is None:
        for i in mp.errors:
            print(f"{args.file}:{i.line}: {i.level} {i.code} {i.msg}", file=sys.stderr)
        print("map-render: документ с ошибками не рисуется — сначала bft-map-lint.py", file=sys.stderr)
        return 1
    out_dir = args.out_dir or args.file.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = args.file.name[:-3] if args.file.name.endswith(".md") else args.file.stem
    out = out_dir / f"{stem}.html"
    out.write_text(render(mp), encoding="utf-8")
    print(f"map-render: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
