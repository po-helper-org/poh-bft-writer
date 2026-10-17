#!/usr/bin/env python3
"""bft-blueprint-render — собирает диаграмму Service Blueprint из `<epic_slug>-blueprint.md`.

Выход рядом с документом (или в `--out-dir`):
  <epic_slug>-blueprint.svg   диаграмма — вкладывается в Confluence как картинка
  <epic_slug>-blueprint.html  страница: образ результата, диаграмма, «что реализовать по слоям»,
                              покрытие требований БФТ, список [УТОЧНИТЬ]. Один файл, без CDN и рантайма.

Диаграмма — детерминированная раскладка на Python: колонки — стадии пути клиента, строки —
слои (выгода → действия → точки контакта │ витрина │ сервисы │ основа), карточки стоят в ячейке
«дорожка × стадия», стрелки идут по межколоночным коридорам и не пересекают чужие карточки.

Рисует только то, что прошло линтер: сломанный документ диаграммы не получает.

Использование:
    python3 bft-blueprint-render.py <epic>-blueprint.md [--source БФТ.md | --no-source] [--out-dir DIR]
Коды выхода: 0 — собрано; 1 — линтер нашёл ошибки (файлы не пишутся); 2 — файл не прочитан.
"""
from __future__ import annotations

import argparse
import html
import importlib.util
import sys
import textwrap
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import bft_blueprint as bb  # noqa: E402

_spec = importlib.util.spec_from_file_location("bft_blueprint_lint", HERE / "bft-blueprint-lint.py")
lint = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(lint)

# --- геометрия ---------------------------------------------------------------
CW = 178          # ширина карточки = ширина колонки
GAP = 38          # коридор между колонками
MARGIN = 118      # слева: подписи линий
LABEL_W = 172     # подпись дорожки
LANE_PAD = 14
CELL_GAP = 10
LINE_H = 15
WRAP = 24
STAGE_WRAP = 19
LEGEND_H = 46

KIND_LABEL = {"создать": "СОЗДАТЬ", "доработать": "ДОРАБОТАТЬ", "используем": "ЕСТЬ", "уточнить": "УТОЧНИТЬ"}
LAYER_CLASS = {"выгода": "gain", "действия": "act", "контакт": "touch", "витрина": "front", "сервис": "back", "основа": "sup"}
BOUNDARIES = {
    "контакт": "Линия взаимодействия",
    "витрина": "Линия видимости",
    "сервис": "Линия внутреннего взаимодействия",
}

CSS = """
.bp{font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.bp .band-a{fill:var(--band-a,#f8f8f8)} .bp .band-b{fill:var(--band-b,#f1f1f1)}
.bp .hdr{fill:var(--hdr,#ffffff);stroke:var(--rule,#cfd3d8)} .bp .hdr-n{fill:var(--ink,#1f2328)}
.bp .t-stage{fill:var(--ink,#1f2328);font-size:12px;font-weight:600}
.bp .t-lane{fill:var(--ink,#1f2328);font-size:13px;font-weight:700}
.bp .t-owner{fill:var(--muted,#59636e);font-size:11px}
.bp .t-line{fill:var(--ink,#1f2328);font-size:12px}
.bp .boundary{stroke:var(--ink,#1f2328);stroke-width:1.2;stroke-dasharray:7 5}
.bp .gain{fill:#f28b50}.bp .act{fill:#f28b50}.bp .touch{fill:#fbc34e}
.bp .front{fill:#2fb0cb}.bp .back{fill:#0b6ea8}.bp .sup{fill:#58537a}
.bp .strip-gain,.bp .strip-act{fill:#f28b50}.bp .strip-touch{fill:#fbc34e}
.bp .strip-front{fill:#2fb0cb}.bp .strip-back{fill:#0b6ea8}.bp .strip-sup{fill:#58537a}
.bp .card text{fill:#fff;font-size:12px}.bp .card.touch text{fill:#1f2328}
.bp .card .cid{font-size:9px;opacity:.85}
.bp .card .refs{font-size:10px;font-weight:700}
.bp .card .pill{fill:rgba(0,0,0,.28)}.bp .card.touch .pill{fill:rgba(0,0,0,.14)}
.bp .card .badge{font-size:9px;font-weight:700;letter-spacing:.04em}
.bp .card.have{opacity:.7}
.bp .card.gap rect.body{stroke:var(--ink,#1f2328);stroke-width:1.6;stroke-dasharray:5 3}
.bp .link{fill:none;stroke-width:1.6;stroke-linejoin:round}
.bp .link.flow{stroke:var(--flow,#30363d)} .bp .link.call{stroke:var(--call,#0b57d0)}
.bp .link.data{stroke:var(--data,#6e7781);stroke-dasharray:5 4}
.bp .mk-flow{fill:var(--flow,#30363d)} .bp .mk-call{fill:var(--call,#0b57d0)} .bp .mk-data{fill:var(--data,#6e7781)}
.bp .t-leg{fill:var(--ink,#1f2328);font-size:11px}
"""

PAGE_CSS = """
:root{--bg:#fff;--ink:#1f2328;--muted:#59636e;--rule:#cfd3d8;--band-a:#f8f8f8;--band-b:#f1f1f1;--hdr:#fff;
--flow:#30363d;--call:#0b57d0;--data:#6e7781;--warn:#b42318;--warn-bg:#fdecea;--chip:#eef1f4}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0f1318;--ink:#e6e9ed;--muted:#9aa4af;--rule:#39424d;
--band-a:#171c22;--band-b:#1d232a;--hdr:#12171d;--flow:#c9d1d9;--call:#79a8ff;--data:#8b949e;--warn:#ff8a80;--warn-bg:#3a1c1a;--chip:#232a32}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:1440px;margin:0 auto;padding:24px 16px 56px}
h1{font-size:24px;margin:0 0 6px} h2{font-size:18px;margin:36px 0 12px}
.meta{display:flex;flex-wrap:wrap;gap:6px 14px;color:var(--muted);font-size:13px;margin-bottom:18px}
.meta b{color:var(--ink);font-weight:600}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{border:1px solid var(--rule);padding:7px 10px;text-align:left;vertical-align:top}
th{background:var(--band-b);font-weight:600}
.image th{width:220px}
.diagram{overflow-x:auto;border:1px solid var(--rule);border-radius:8px;background:var(--bg);padding:8px}
.diagram svg{display:block;width:100%;min-width:980px;height:auto}
.chip{display:inline-block;background:var(--chip);border-radius:10px;padding:0 8px;margin:1px 3px 1px 0;font-size:12px;white-space:nowrap}
.k{font-size:11px;font-weight:700;letter-spacing:.03em}
tr.gap td{background:var(--warn-bg)} .bad{color:var(--warn);font-weight:600}
.lane h3{margin:18px 0 4px;font-size:15px} .lane .sub{color:var(--muted);font-size:13px;margin-bottom:4px}
.lane ul{margin:4px 0 0;padding-left:20px} .lane li{margin:2px 0}
.note{color:var(--muted);font-size:13px}
@media print{.diagram{overflow:visible;border:0;padding:0}body{font-size:12px}}
"""


# --- раскладка ---------------------------------------------------------------
class Box:
    def __init__(self, card: bb.Card, col: int, lane_idx: int):
        self.card, self.col, self.lane_idx = card, col, lane_idx
        self.lines = textwrap.wrap(card.text, WRAP, break_long_words=True) or [""]
        self.refs = " · ".join(dict.fromkeys(card.reqs))
        self.h = 8 + 15 + 4 + LINE_H * len(self.lines) + (16 if self.refs else 0) + 8
        self.x = self.y = self.w = 0

    @property
    def rect(self):
        return self.x, self.y, CW, self.h


def col_x(c: int, x0: float) -> float:
    return x0 + c * (CW + GAP)


def layout(bp: bb.Blueprint):
    lanes = bp.ordered_lanes()
    n = len(bp.stages)
    stage_col = {s.id: i for i, s in enumerate(bp.stages)}
    lane_idx = {lid: i for i, (lid, *_rest) in enumerate(lanes)}
    boxes = {c.id: Box(c, stage_col[c.stage], lane_idx[c.lane]) for c in bp.cards}

    x0 = MARGIN + LABEL_W + GAP
    width = x0 + n * (CW + GAP)
    hdr_lines = max(len(textwrap.wrap(s.name, STAGE_WRAP)) for s in bp.stages)
    hdr_h = 14 + 15 * hdr_lines + 12
    y = hdr_h + 12
    lane_geo = []  # (top, bottom) на дорожку
    boundary_y = {}  # индекс дорожки, после которой стоит линия -> y
    for i, (lid, layer, _name, _owner) in enumerate(lanes):
        cells: dict[int, list[Box]] = {}
        for b in boxes.values():
            if b.lane_idx == i:
                cells.setdefault(b.col, []).append(b)
        tallest = max((sum(b.h for b in bs) + CELL_GAP * (len(bs) - 1) for bs in cells.values()), default=0)
        height = max(66, tallest + 2 * LANE_PAD)
        for col, bs in cells.items():
            top = y + (height - (sum(b.h for b in bs) + CELL_GAP * (len(bs) - 1))) / 2
            for b in sorted(bs, key=lambda b: b.card.line):
                b.x, b.y = col_x(col, x0), top
                top += b.h + CELL_GAP
        lane_geo.append((y, y + height))
        y += height
        nxt = lanes[i + 1][1] if i + 1 < len(lanes) else None
        # линия внутреннего взаимодействия — только между сервисами и основой
        if (layer in ("контакт", "витрина")) or (layer == "сервис" and nxt == "основа"):
            boundary_y[i] = y + 6
            y += 12
        else:
            y += 4
    return lanes, boxes, x0, width, hdr_h, lane_geo, boundary_y, y


# --- стрелки -----------------------------------------------------------------
def _hits(p, q, rect, pad=3):
    rx, ry, rw, rh = rect
    x1, x2 = sorted((p[0], q[0]))
    y1, y2 = sorted((p[1], q[1]))
    return x1 <= rx + rw + pad and x2 >= rx - pad and y1 <= ry + rh + pad and y2 >= ry - pad


def _cost(points, others):
    return sum(_hits(a, b, o) for a, b in zip(points, points[1:]) for o in others)


def route(s: Box, d: Box, boxes, x0, lane_geo):
    sx, sy, sw, sh = s.rect
    dx, dy, dw, dh = d.rect
    scx, scy, dcx, dcy = sx + sw / 2, sy + sh / 2, dx + dw / 2, dy + dh / 2
    Rs, Ls, Ts, Bs = (sx + sw, scy), (sx, scy), (scx, sy), (scx, sy + sh)
    Rd, Ld, Td, Bd = (dx + dw, dcy), (dx, dcy), (dcx, dy), (dcx, dy + dh)
    cands = []
    if s.col == d.col:
        cands.append([Bs, Td] if dcy > scy else [Ts, Bd])
        gl, gr = col_x(s.col, x0) - GAP / 2, col_x(s.col, x0) + CW + GAP / 2
        cands += [[Ls, (gl, scy), (gl, dcy), Ld], [Rs, (gr, scy), (gr, dcy), Rd]]
    else:
        right = d.col > s.col
        a, b = (Rs, Ld) if right else (Ls, Rd)
        g1 = col_x(s.col, x0) + (CW + GAP / 2 if right else -GAP / 2)
        g2 = col_x(d.col, x0) + (-GAP / 2 if right else CW + GAP / 2)
        if abs(scy - dcy) < 1:
            cands.append([a, b])
        cands += [[a, (g1, scy), (g1, dcy), b], [a, (g2, scy), (g2, dcy), b]]
        if s.lane_idx != d.lane_idx:
            down = d.lane_idx > s.lane_idx
            top, bottom = lane_geo[s.lane_idx]
            yb = bottom - 7 if down else top + 7
            cands.append([Bs if down else Ts, (scx, yb), (dcx, yb), Td if down else Bd])
    others = [b.rect for b in boxes.values() if b is not s and b is not d]
    return min(cands, key=lambda pts: _cost(pts, others))  # min устойчив: при равенстве — первый


def _path(points) -> str:
    return "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in points)


# --- SVG ---------------------------------------------------------------------
def esc(s: str) -> str:
    return html.escape(s, quote=True)


def render_svg(bp: bb.Blueprint, reqs: dict[str, str]) -> str:
    lanes, boxes, x0, width, hdr_h, lane_geo, boundary_y, y_end = layout(bp)
    height = y_end + 8 + LEGEND_H
    o = [
        f'<svg xmlns="http://www.w3.org/2000/svg" class="bp" viewBox="0 0 {width:.0f} {height:.0f}" '
        f'width="{width:.0f}" height="{height:.0f}" role="img" aria-label="Service Blueprint: {esc(bp.title)}">',
        f"<style>{CSS}</style>",
        "<defs>"
        + "".join(
            f'<marker id="ah-{k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">'
            f'<path class="mk-{k}" d="M0,0L10,5L0,10z"/></marker>'
            for k in ("flow", "call", "data")
        )
        + "</defs>",
    ]
    # заголовки стадий
    for i, s in enumerate(bp.stages):
        cx = col_x(i, x0)
        o.append(f'<rect class="hdr" x="{cx:.0f}" y="4" width="{CW}" height="{hdr_h - 4}" rx="6"/>')
        o.append(f'<text class="t-stage" x="{cx + 10:.0f}" y="24"><tspan opacity=".6">{esc(s.id)}</tspan></text>')
        for k, ln in enumerate(textwrap.wrap(s.name, STAGE_WRAP)):
            o.append(f'<text class="t-stage" x="{cx + 34:.0f}" y="{24 + 15 * k}">{esc(ln)}</text>')
    # полосы дорожек и подписи
    for i, (lid, layer, name, owner) in enumerate(lanes):
        top, bottom = lane_geo[i]
        cls = LAYER_CLASS[layer]
        o.append(f'<rect class="band-{"a" if i % 2 == 0 else "b"}" x="{MARGIN}" y="{top:.0f}" width="{width - MARGIN:.0f}" height="{bottom - top:.0f}"/>')
        o.append(f'<rect class="strip-{cls}" x="{MARGIN}" y="{top:.0f}" width="8" height="{bottom - top:.0f}"/>')
        name_lines = textwrap.wrap(name, 18)
        owner_lines = textwrap.wrap(owner, 22)[:2] if owner else []
        total = 14 * len(name_lines) + (12 * len(owner_lines) + 2 if owner_lines else 0)
        ty = top + (bottom - top - total) / 2 + 11
        for k, ln in enumerate(name_lines):
            o.append(f'<text class="t-lane" x="{MARGIN + 20}" y="{ty + 14 * k:.0f}">{esc(ln)}</text>')
        for k, ln in enumerate(owner_lines):
            o.append(f'<text class="t-owner" x="{MARGIN + 20}" y="{ty + 14 * len(name_lines) + 2 + 12 * k:.0f}">{esc(ln)}</text>')
    # линии слоёв
    for i, y in boundary_y.items():
        label = BOUNDARIES[lanes[i][1]]
        o.append(f'<line class="boundary" x1="6" y1="{y}" x2="{width - 4:.0f}" y2="{y}"/>')
        label_lines = textwrap.wrap(label, 16)
        for k, ln in enumerate(label_lines):
            o.append(f'<text class="t-line" x="8" y="{y - 5 - 14 * (len(label_lines) - 1 - k)}">{esc(ln)}</text>')
    # стрелки
    for lk in bp.links:
        pts = route(boxes[lk.src], boxes[lk.dst], boxes, x0, lane_geo)
        k = {"поток": "flow", "вызов": "call", "данные": "data"}[lk.type]
        o.append(f'<path class="link {k}" d="{_path(pts)}" marker-end="url(#ah-{k})"><title>{esc(lk.src)} → {esc(lk.dst)} ({esc(lk.type)})</title></path>')
    # карточки
    layer_title = bb.LAYER_TITLE
    for b in boxes.values():
        c = b.card
        cls = f"card {LAYER_CLASS[c.layer]}" + (" gap" if c.has_gap else "") + (" have" if c.kind == "используем" else "")
        tip = [f"{c.id} · {layer_title[c.layer]} · {c.stage}", c.text]
        tip += [f"{r}: {reqs.get(r) or '—'}" for r in c.reqs]
        o.append(f'<g class="{cls}"><title>{esc(chr(10).join(tip))}</title>')
        o.append(f'<rect class="body {LAYER_CLASS[c.layer]}" x="{b.x:.0f}" y="{b.y:.0f}" width="{CW}" height="{b.h:.0f}" rx="5"/>')
        if c.kind:
            lab = KIND_LABEL[c.kind]
            pw = 9 + 6.2 * len(lab)
            o.append(f'<rect class="pill" x="{b.x + 6:.0f}" y="{b.y + 6:.0f}" width="{pw:.0f}" height="14" rx="7"/>')
            o.append(f'<text class="badge" x="{b.x + 6 + pw / 2:.0f}" y="{b.y + 16:.0f}" text-anchor="middle">{lab}</text>')
        o.append(f'<text class="cid" x="{b.x + CW - 8:.0f}" y="{b.y + 16:.0f}" text-anchor="end">{esc(c.id)}</text>')
        for k, ln in enumerate(b.lines):
            o.append(f'<text x="{b.x + 8:.0f}" y="{b.y + 8 + 15 + 4 + LINE_H * (k + 1) - 4:.0f}">{esc(ln)}</text>')
        if b.refs:
            o.append(f'<text class="refs" x="{b.x + 8:.0f}" y="{b.y + b.h - 9:.0f}">{esc(b.refs)}</text>')
        o.append("</g>")
    o.append(_legend(y_end + 14, x0))
    o.append("</svg>")
    return "\n".join(o)


def _legend(y: float, x0: float) -> str:
    items = [
        ("rect", "front", "СОЗДАТЬ / ДОРАБОТАТЬ — работа этой инициативы"),
        ("rect-have", "front", "ЕСТЬ — используем как есть"),
        ("rect-gap", "front", "штрих — есть [УТОЧНИТЬ]"),
    ]
    o, x = [], MARGIN
    for kind, cls, label in items:
        extra = ' opacity=".7"' if kind == "rect-have" else ""
        stroke = ' stroke="currentColor" stroke-dasharray="3 2"' if kind == "rect-gap" else ""
        o.append(f'<rect class="{cls}" x="{x}" y="{y:.0f}" width="22" height="12" rx="3"{extra}{stroke}/>')
        o.append(f'<text class="t-leg" x="{x + 28}" y="{y + 10:.0f}">{esc(label)}</text>')
        x += 28 + 6.2 * len(label) + 18
    x = MARGIN
    for k, label in (("flow", "поток — следующий шаг"), ("call", "вызов — одно запускает другое"), ("data", "данные — передаётся результат")):
        o.append(f'<path class="link {k}" d="M{x},{y + 30:.0f} L{x + 30},{y + 30:.0f}" marker-end="url(#ah-{k})"/>')
        o.append(f'<text class="t-leg" x="{x + 38}" y="{y + 34:.0f}">{esc(label)}</text>')
        x += 38 + 6.2 * len(label) + 22
    return "\n".join(o)


# --- страница ----------------------------------------------------------------
def chips(ids) -> str:
    return "".join(f'<span class="chip">{esc(i)}</span>' for i in ids) or "—"


def render_html(bp: bb.Blueprint, svg: str, reqs: dict[str, str]) -> str:
    m = bp.meta
    out = [
        "<!doctype html>",
        '<html lang="ru"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        f"<title>Blueprint — {esc(bp.meta.get('epic_slug', ''))}</title>",
        f"<style>{PAGE_CSS}</style></head><body><main>",
        f"<h1>Service Blueprint: {esc(bp.title)}</h1>",
        '<div class="meta">'
        + "".join(
            f"<span>{k}: <b>{esc(m.get(key, '—'))}</b></span>"
            for k, key in (("эпик", "epic_slug"), ("статус", "status"), ("версия", "version"), ("обновлён", "revised"), ("БФТ", "source_stage"), ("rev БФТ", "source_rev"))
        )
        + "</div>",
        "<h2>Образ результата</h2>",
        '<table class="image">'
        + "".join(f"<tr><th>{esc(k)}</th><td>{esc(v)}</td></tr>" for k, v in bp.image.items())
        + "</table>",
        "<h2>Диаграмма по слоям</h2>",
        f'<div class="diagram">{svg}</div>',
        '<p class="note">Колонки — стадии пути клиента, строки — слои экосистемы. Пунктирные линии отделяют то, что видит клиент, от того, что он не видит. '
        "Подсказка по наведению на карточку: полный текст и наименования требований БФТ.</p>",
        "<h2>Что реализовать на каждом слое</h2>",
    ]
    by_lane: dict[str, list[bb.Card]] = {}
    for c in bp.cards:
        by_lane.setdefault(c.lane, []).append(c)
    stage_order = {s.id: i for i, s in enumerate(bp.stages)}
    for lid, layer, name, owner in bp.ordered_lanes():
        cards = sorted(by_lane.get(lid, []), key=lambda c: (stage_order[c.stage], c.line))
        counts = {k: sum(1 for c in cards if c.kind == k) for k in bb.KINDS}
        stat = " · ".join(f"{KIND_LABEL[k].lower()}: {v}" for k, v in counts.items() if v)
        sub = " · ".join(x for x in (bb.LAYER_TITLE[layer] if bb.LAYER_TITLE[layer] != name else "", owner, stat) if x)
        out.append(f'<div class="lane"><h3>{esc(name)}</h3><div class="sub">{esc(sub)}</div>')
        if cards:
            out.append("<ul>")
            for c in cards:
                kind = f'<span class="k">{KIND_LABEL[c.kind]}</span> ' if c.kind else ""
                gap = ' <span class="bad">[УТОЧНИТЬ]</span>' if c.has_gap and bb.MARKER not in c.text else ""
                out.append(f"<li>{esc(c.stage)} · {kind}{esc(c.text)}{gap} {chips(c.reqs)}</li>")
            out.append("</ul>")
        else:
            out.append('<div class="note">карточек нет</div>')
        out.append("</div>")

    drawn: dict[str, list[bb.Card]] = {}
    for c in bp.cards:
        for r in c.reqs:
            drawn.setdefault(r, []).append(c)
    ids = list(reqs) or sorted(drawn)
    out += ["<h2>Покрытие требований БФТ</h2>", "<table><tr><th>Требование</th><th>Наименование</th><th>Карточки</th><th>Слои</th></tr>"]
    for rid in ids:
        cs = drawn.get(rid, [])
        layers = list(dict.fromkeys(bb.LAYER_TITLE[c.layer] for c in cs))
        row_cls = ' class="gap"' if not cs and rid.split("-")[0] in ("ФТ", "ИТ", "НФТ") else ""
        cell = chips(c.id for c in cs) if cs else '<span class="bad">не нарисовано</span>'
        out.append(f"<tr{row_cls}><td>{esc(rid)}</td><td>{esc(reqs.get(rid, ''))}</td><td>{cell}</td><td>{esc(', '.join(layers)) or '—'}</td></tr>")
    out.append("</table>")

    gaps = [c for c in bp.cards if c.has_gap]
    out.append("<h2>Что ещё не решено</h2>")
    if gaps:
        out.append("<table><tr><th>Карточка</th><th>Слой · стадия</th><th>Текст</th></tr>")
        for c in gaps:
            out.append(f"<tr><td>{esc(c.id)}</td><td>{esc(bb.LAYER_TITLE[c.layer])} · {esc(c.stage)}</td><td>{esc(c.text)}</td></tr>")
        out.append("</table>")
    else:
        out.append('<p class="note">Все карточки опираются на решённые требования БФТ.</p>')
    out.append(
        f'<p class="note">Источник правды — <code>{esc(bp.path.name)}</code>. Страница только для чтения: правки вносятся в документ, затем команда '
        f"<code>/bft-blueprint {esc(m.get('epic_slug', ''))}</code> пересобирает диаграмму.</p>"
    )
    out.append("</main></body></html>")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("file", type=Path)
    ap.add_argument("--source", help="путь к БФТ (по умолчанию — `source_doc` из frontmatter)")
    ap.add_argument("--no-source", action="store_true")
    ap.add_argument("--out-dir", type=Path)
    args = ap.parse_args()
    try:
        bp = lint.run(args.file, args.source, args.no_source)
    except OSError as e:
        print(f"{args.file}: не прочитан: {e}", file=sys.stderr)
        return 2
    if bp.errors:
        for i in bp.errors:
            print(f"{args.file}:{i.line}: {i.level} {i.code} {i.msg}", file=sys.stderr)
        print("blueprint-render: линтер нашёл ошибки — диаграмма не собрана", file=sys.stderr)
        return 1
    for i in bp.issues:
        print(f"{args.file}:{i.line}: {i.level} {i.code} {i.msg}", file=sys.stderr)
    src = lint.resolve_source(bp, args.source)
    reqs = bb.load_requirements(src)[0] if not args.no_source and src and src.is_file() else {}
    svg = render_svg(bp, reqs)
    out_dir = args.out_dir or args.file.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = args.file.name.removesuffix(".md")
    (out_dir / f"{stem}.svg").write_text('<?xml version="1.0" encoding="UTF-8"?>\n' + svg, encoding="utf-8")
    (out_dir / f"{stem}.html").write_text(render_html(bp, svg, reqs), encoding="utf-8")
    print(f"blueprint-render: {out_dir / (stem + '.html')} и {out_dir / (stem + '.svg')} — {len(bp.cards)} карточек, {len(bp.links)} связей")
    return 0


if __name__ == "__main__":
    sys.exit(main())
