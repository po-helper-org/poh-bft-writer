#!/usr/bin/env python3
"""bft-backlog-build — страница Service Blueprint и архив проекта из проекта Backlog.md.

Детерминированно, без ИИ:
1. проверка проекта (`bft-backlog-lint.py`); с ошибками ничего не собирается — код 1;
2. IDEF0 карточек «Как это работает» — mermaid из «Параметров» (блок `### IDEF0` в файле карточки);
3. `<epic>-map.html` — одна страница без CDN: «Что видят», «Что делаем», «Как это работает»;
4. `<epic>-blueprint.zip` — автономный проект: папка Backlog.md, страница `blueprint.html` и
   `.blueprint/` — эти скрипты и правила. Распаковал — ведёшь бэклог CLI `backlog` и пересобираешь
   страницу `python3 .blueprint/scripts/bft-backlog-build.py .`

Использование:
    python3 bft-backlog-build.py <проект> [--out-dir КАТАЛОГ] [--source БФТ.md | --no-source] [--check] [--no-zip]

--check — ничего не пишет: устаревший IDEF0 — ошибка (для CI и самотеста).
По умолчанию файлы ложатся рядом с папкой проекта.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import importlib.util
import json
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import bft_backlog as bl  # noqa: E402
import bft_story as bs  # noqa: E402
import bft_screens as bsn  # noqa: E402

_spec = importlib.util.spec_from_file_location("bl_lint", HERE / "bft-backlog-lint.py")
lint = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(lint)

TOOLS = ("bft_blueprint.py", "bft_story.py", "bft_screens.py", "bft_backlog.py", "bft-blueprint-lint.py",
         "bft-backlog-lint.py", "bft-backlog-build.py", "bft-backlog-init.py", "page_kit.js", "map_page.js", "map_page.css")
RULES = ("backlog_rules.md", "screen_notes.md", "story_line.md")
ZIP_DATE = (1980, 1, 1, 0, 0, 0)

PAGE = """<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title_tag}</title>
<style>
{css}</style></head>
<body>
<h1 class="ptitle">{h1}</h1>
<div class="fab"><button class="burger" id="burger" aria-label="Меню карты" aria-expanded="false" aria-controls="menu"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11"/></svg><span class="bdot" id="bdot"></span></button><nav class="views" aria-label="Слой карты"><button data-view="see" class="on">Что видят</button><button data-view="do">Что делаем</button><button data-view="how">Как это работает</button></nav><span id="fchip"></span><button class="cmchip" id="cmchip" data-cmpanel hidden></button></div>
<div class="mscrim"></div>
<nav class="menu" id="menu" aria-label="Меню карты"><div class="mtop"><div><span class="draft{status_cls}">{status}</span><h1>{h1}</h1></div><button class="x" data-menu="close" aria-label="Закрыть">×</button></div>
<button class="play" id="play">▶ Рассказать историю</button>
<div class="mlist"><span id="blk"></span>
<button class="mi" data-guide="help"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h4.5A1.5 1.5 0 0 1 8 4.5V14a1.5 1.5 0 0 0-1.5-1.5H2zM14 3H9.5A1.5 1.5 0 0 0 8 4.5V14a1.5 1.5 0 0 1 1.5-1.5H14z"/></svg>Инструкции</button>
<button class="mi" data-guide="legend"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2.5" width="4" height="4" rx="1"/><path d="M8.5 4.5H14"/><circle cx="4" cy="11.5" r="2"/><path d="M8.5 11.5H14"/></svg>Легенда</button>
<button class="mi" data-cmpanel><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z"/></svg>Замечания<b class="cnt cmn" id="cmn" hidden></b></button></div>
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
{js}</script>
</body></html>
"""


def step_json(s: bs.Step) -> dict:
    return {"id": s.id, "title": s.title, "text": s.text, "was": s.was, "screens": s.screens, "source": s.source}


def model(pr: bl.Project) -> dict:
    st = pr.story
    cols = [s.id for s in st.stages] + [bl.FINAL]
    names = {p.id: p.name for p in st.personas}

    # «Что видят»: по карточке на персонажа и этап; итог — карточки «стало»
    seen = []
    for p in st.personas:
        for ci, sid in enumerate(cols):
            if sid == bl.FINAL:
                fin = next((s for s in st.steps_of(p.id) if s.kind == "final"), None)
                if fin:
                    big = p.after.split("·")[0].strip()
                    seen.append({"key": f"{p.id}:{sid}", "persona": p.id, "col": ci, "final": True,
                                 "big": "" if big in bs.EMPTY else big, "title": fin.title, "steps": [step_json(fin)]})
                continue
            steps = [s for s in st.steps_of(p.id) if s.kind == "step" and s.stage_from == sid]
            if steps:
                seen.append({"key": f"{p.id}:{sid}", "persona": p.id, "col": ci, "final": False,
                             "steps": [step_json(s) for s in steps]})
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

    doc_of = {d.path: k for k, d in pr.docs.items()}
    doc_screen = {doc_of[d.path]: sid for sid, d in pr.screens.items()}
    docs = {k: {"title": d.title, "file": d.rel, "screen": doc_screen.get(k, "")} for k, d in pr.docs.items()}
    common = lambda t: {"id": t.id, "stage": t.stage, "team": t.team, "text": t.title, "status": t.status,  # noqa: E731
                        "refs": [str(x) for x in t.refs], "docs": [str(x) for x in t.docs], "file": t.rel}
    tasks = [{**common(t), "cand": t.cand, "why": t.why, "reqs": t.reqs, "kind": t.kind, "notes": t.notes,
              "brief": {k: v[1] for k, v in t.sections.items()}, "ac": [[d, x] for d, x in t.ac]} for t in pr.tasks]
    cards = [{**common(c), "task": c.parent, "layer": c.layer, "lead": c.lead,
              "params": {k: [{"t": it.text, "r": it.refs} for it in v] for k, v in c.params.items()},
              "demo": c.sections.get("HowToDemo", (0, ""))[1]} for c in pr.cards]
    return {
        "epic": pr.meta.get("epic_slug", ""), "title": pr.title, "prefix": pr.prefix,
        "stages": [{"id": s.id, "name": s.name, "when": s.when} for s in st.stages],
        "personas": [{"id": p.id, "name": names[p.id], "lane": p.lane} for p in st.personas],
        "seen": seen, "story": story,
        "screens": {sc.id: {"contour": sc.contour, "device": sc.device, "view": sc.view, "el": sc.elements} for sc in st.screens},
        "notes": {sid: bsn.page_md(doc) for sid, doc in sorted(pr.screens.items())},
        "noteFiles": {sid: doc.rel for sid, doc in sorted(pr.screens.items())},
        "docs": docs,
        "storyQuestions": [{"id": q.id, "to": q.to, "text": q.text, "where": q.where} for q in st.questions if q.open],
        "teams": [{"id": t.id, "name": t.name} for t in pr.teams], "tasks": tasks, "cards": cards,
        "links": [{"src": a, "dst": b, "what": w} for a, b, w in pr.links()],
        "questions": [{"id": q.id, "to": q.to, "text": q.text, "where": q.where, "kind": q.kind,
                       "open": q.open, "answer": q.answer} for q in pr.questions],
        "files": {"map": pr.map_doc.rel, "story": pr.story_doc.rel, "source": pr.meta.get("source_doc", ""),
                  "project": f"{pr.meta.get('epic_slug', 'epic')}-blueprint"},
    }


def render(pr: bl.Project) -> str:
    m = model(pr)
    # ревизия страницы: пересобранная карта закрывает замечания прошлого круга
    m["rev"] = hashlib.sha1(json.dumps(m, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:12]
    data = json.dumps(m, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    status = pr.meta.get("status", "")
    return PAGE.format(
        title_tag=html.escape(f"Карта · {pr.meta.get('epic_slug', '')}"), h1=html.escape(pr.title),
        status=html.escape(status), status_cls=" ok" if status.lower() == "согласован" else "",
        css=(HERE / "map_page.css").read_text(encoding="utf-8"),
        kit=(HERE / "page_kit.js").read_text(encoding="utf-8"),
        js=(HERE / "map_page.js").read_text(encoding="utf-8"), data=data)


def rules_dir() -> Path:
    for p in (HERE.parent / "resources", HERE.parent / "rules"):
        if p.is_dir():
            return p
    return HERE.parent / "resources"


def build_zip(pr: bl.Project, page: str, out: Path) -> int:
    """Архив без дат и прав системы: тот же проект — тот же zip байт в байт."""
    name = f"{pr.meta.get('epic_slug', 'epic')}-blueprint"
    entries: dict[str, bytes] = {}
    for f in sorted(pr.root.rglob("*")):
        rel = f.relative_to(pr.root).as_posix()
        if not f.is_file() or rel.startswith((".blueprint/", ".git/")) or "/" not in rel and f.suffix in (".html", ".zip"):
            continue
        entries[rel] = f.read_bytes()
    entries["blueprint.html"] = page.encode("utf-8")
    for t in TOOLS:
        entries[f".blueprint/scripts/{t}"] = (HERE / t).read_bytes()
    for r in RULES:
        if (rules_dir() / r).is_file():
            entries[f".blueprint/rules/{r}"] = (rules_dir() / r).read_bytes()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in sorted(entries):
            info = zipfile.ZipInfo(f"{name}/{rel}", date_time=ZIP_DATE)
            info.external_attr = (0o755 if rel.endswith(".py") else 0o644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, entries[rel])
    return len(entries)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("project", type=Path)
    ap.add_argument("--out-dir", type=Path, help="куда писать .html и .zip (по умолчанию — рядом с папкой проекта)")
    ap.add_argument("--source", help="путь к БФТ (по умолчанию — `source_doc` паспорта)")
    ap.add_argument("--no-source", action="store_true", help="не сверять с БФТ")
    ap.add_argument("--check", action="store_true", help="ничего не писать: проверка и устаревшие IDEF0")
    ap.add_argument("--no-zip", action="store_true", help="только страница")
    args = ap.parse_args()
    root = args.project.resolve()
    pr = lint.run(root, args.source, args.no_source)
    stale = [i for i in pr.issues if i.code == "BL022"]
    if args.check and stale:
        for i in stale:
            i.level = "ERROR"
    if pr.errors:
        lint.report(pr, False, "backlog-build")
        print("backlog-build: проект с ошибками не собирается — исправь и запусти снова", file=sys.stderr)
        return 1
    if args.check:
        return lint.report(pr, False, "backlog-build")
    synced = bl.sync_idef(pr, write=True)
    if synced:
        print(f"backlog-build: IDEF0 пересобран из «Параметров» — {', '.join(c.id for c in synced)}")
        pr = lint.run(root, args.source, args.no_source)
    lint.report(pr, False, "backlog-build")
    out_dir = (args.out_dir or root.parent).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    epic = pr.meta.get("epic_slug", "epic")
    page = render(pr)
    (out_dir / f"{epic}-map.html").write_text(page, encoding="utf-8")
    print(f"backlog-build: {out_dir / f'{epic}-map.html'}")
    if not args.no_zip:
        n = build_zip(pr, page, out_dir / f"{epic}-blueprint.zip")
        print(f"backlog-build: {out_dir / f'{epic}-blueprint.zip'} — файлов {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
