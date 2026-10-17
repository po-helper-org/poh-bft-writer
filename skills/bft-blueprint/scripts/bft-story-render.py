#!/usr/bin/env python3
"""bft-story-render — страница истории через экраны из `<epic_slug>-story.md`.

Собирает `<epic_slug>-story.html` рядом с документом: верхняя линия blueprint, которая читается
слева направо через экраны. Карточка шага — картинка, контур, заголовок, пояснение; клик —
подробности шага; «Рассказать историю по шагам» — тот же сюжет слайдами. Один файл без CDN:
стили и скрипт (`story_page.css`, `story_page.js`) вставляются внутрь, данные — JSON.

Сломанный документ (ошибки линтера) не рисуется: код 1, файлов нет.

Использование:
    python3 bft-story-render.py <epic>-story.md [--out-dir КАТАЛОГ]
"""
from __future__ import annotations

import argparse
import html
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import bft_story as bs  # noqa: E402

PAGE = """<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title_tag}</title>
<style>
{css}</style></head>
<body>
<header><h1>{h1}</h1>
<p class="sub">По БФТ {epic} · версия {version} от {revised} · {status}. История читается слева направо: что инициатива меняет для каждого, кто будет ей пользоваться. Нажмите на шаг — подробности и источник в БФТ; красная точка — открытый вопрос.</p>
<button class="play" id="play">▶ Рассказать историю по шагам</button></header>
<div class="legend" id="legend"></div>
<div class="wrap"><div class="grid" id="grid"></div></div>
<section class="qs" id="qs"></section>
<div class="scrim" id="scrim"></div><aside class="pn" id="pn" aria-label="Шаг истории"></aside>
<div class="show" id="show" role="dialog" aria-label="История по шагам"><div class="sbar"><div class="who"></div><button class="x" aria-label="Закрыть">×</button></div>
<div class="stage"></div><div class="snav"><button class="prev">← Назад</button><div class="dots"></div><button class="next">Дальше →</button></div></div>
<script type="application/json" id="story-data">{data}</script>
<script>
{js}</script>
</body></html>
"""


def model(st: bs.Story) -> dict:
    stage_name = {s.id: s.name for s in st.stages}
    steps = []
    by_screen: dict[str, str] = {}
    for p in st.personas:
        n = 0
        for s in st.steps_of(p.id):
            num = None
            if s.kind in ("step", "band"):
                n += 1
                num = n
            span = stage_name.get(s.stage_from, "")
            if s.stage_to != s.stage_from:
                span = f"{s.stage_from}–{s.stage_to} · пока идут другие шаги"
            steps.append({
                "id": s.id, "persona": s.persona, "kind": s.kind, "n": num, "span": span,
                "c0": st.stage_index(s.stage_from), "c1": st.stage_index(s.stage_to),
                "title": s.title, "text": s.text, "screens": s.screens, "was": s.was, "source": s.source,
            })
            for x in s.screens:
                by_screen.setdefault(x, s.title)
    return {
        "stages": [{"id": s.id, "name": s.name, "when": s.when} for s in st.stages],
        "personas": [{"id": p.id, "name": p.name, "lane": p.lane, "before": p.before, "after": p.after} for p in st.personas],
        "steps": steps,
        "screens": {sc.id: {"contour": sc.contour, "device": sc.device, "view": sc.view, "el": sc.elements, "source": sc.source}
                    for sc in st.screens},
        "stepsByScreen": by_screen,
        "questions": [{"id": q.id, "to": q.to, "text": q.text, "where": q.where, "answer": q.answer, "open": q.open}
                      for q in st.questions],
    }


def render(st: bs.Story) -> str:
    data = json.dumps(model(st), ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    meta = st.meta
    title = st.title or meta.get("epic_slug", "")
    return PAGE.format(
        title_tag=html.escape(f"История · {meta.get('epic_slug', '')}"),
        h1=html.escape(f"История: {title}"),
        epic=html.escape(meta.get("epic_slug", "")),
        version=html.escape(meta.get("version", "")),
        revised=html.escape(meta.get("revised", "")),
        status=html.escape(meta.get("status", "")),
        css=(HERE / "story_page.css").read_text(encoding="utf-8"),
        js=(HERE / "story_page.js").read_text(encoding="utf-8"),
        data=data,
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("file", type=Path)
    ap.add_argument("--out-dir", type=Path, help="куда писать .html (по умолчанию — рядом с документом)")
    args = ap.parse_args()
    try:
        st = bs.parse(args.file)
    except OSError as e:
        print(f"{args.file}: не прочитан: {e}", file=sys.stderr)
        return 2
    if st.errors:
        for i in st.errors:
            print(f"{args.file}:{i.line}: {i.level} {i.code} {i.msg}", file=sys.stderr)
        print("story-render: документ с ошибками не рисуется — сначала bft-story-lint.py", file=sys.stderr)
        return 1
    out_dir = args.out_dir or args.file.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = args.file.name[:-3] if args.file.name.endswith(".md") else args.file.stem
    out = out_dir / f"{stem}.html"
    out.write_text(render(st), encoding="utf-8")
    print(f"story-render: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
