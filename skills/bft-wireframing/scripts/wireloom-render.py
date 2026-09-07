#!/usr/bin/env python3
"""wireloom-render — StepByStep-раскадровка HowToDemo: N экранов Wireloom
в рамке браузера или телефона, склеенные стрелками в один SVG.

Вызывается `bft-html-export.py` на блок ```wireloom-storyboard[:device]```
(device — соответствие вызывающего дефолту, но проверяется и здесь: чужой
или пустой параметр не должен тихо съедать раскадровку). Не запускается
отдельно PO — это внутренний рендер-шаг навыка `bft-wireframing`.

Вход (stdin) — тело блока: кадры через строку "===", в каждом кадре первая
часть до строки "---" — подпись, вторая — исходник одного экрана .wireloom
(ровно один window на кадр — ограничение самого Wireloom, не наше).

Выход: SVG на stdout, код 0. Сбой (нет node/npm install, ошибка разбора
.wireloom) — причина на stderr, код 1; страницу это не роняет — вызывающий
подставляет `[УТОЧНИТЬ: <причина>]` вместо картинки.

Использование:
    python3 wireloom-render.py --device browser < блок.txt > раскадровка.svg
    python3 wireloom-render.py --device mobile  < блок.txt > раскадровка.svg
"""
from __future__ import annotations

import argparse
import html
import re
import subprocess
import sys
from pathlib import Path

RUNTIME_DIR = Path(__file__).parent / "wireloom-runtime"
FRAME_SPLIT_RE = re.compile(r"\n===+\s*\n")
SVG_ROOT_RE = re.compile(r'<svg\b([^>]*)>(.*)</svg>\s*\Z', re.S)
WH_RE = re.compile(r'\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"')

INK, ACC, MUTED, LINE, FILL = "#1f2328", "#2b6cb0", "#6b7684", "#c8d0d8", "#eef1f4"


class RenderError(Exception):
    """Не отрендерилось — причина уходит в message, вызывающий её и печатает."""


def render_frame(source: str) -> tuple[float, float, str]:
    """Один экран .wireloom -> (width, height, внутренняя разметка SVG)."""
    script = RUNTIME_DIR / "render.mjs"
    if not (RUNTIME_DIR / "node_modules" / "wireloom").exists():
        raise RenderError(
            "рантайм Wireloom не установлен — в scripts/wireloom-runtime/ выполнить npm install")
    try:
        res = subprocess.run(["node", str(script)], input=source, capture_output=True,
                              text=True, timeout=20)
    except FileNotFoundError:
        raise RenderError("node не найден в PATH")
    except Exception as e:
        raise RenderError(f"Wireloom не запустился — {e}")
    if res.returncode != 0:
        raise RenderError(f"ошибка разбора .wireloom — {res.stderr.strip()[:200]}")
    svg = res.stdout
    m = SVG_ROOT_RE.match(svg.strip())
    if not m:
        raise RenderError("Wireloom вернул не-SVG вывод")
    wh = WH_RE.search(m.group(1))
    w, h = (float(wh.group(1)), float(wh.group(2))) if wh else (200.0, 120.0)
    return w, h, m.group(2)


# ---------- Рамки кадра: browser | mobile ----------
# Декоративная обвязка — единственное, что дописано поверх рендера Wireloom;
# само содержимое экрана (виджеты, текст, цвета) целиком его выход. Ни
# в одной рамке нет текста, который выглядел бы как факт (домен в адресной
# строке, время/заряд в статус-баре): рамка — chrome, не источник данных.

def wrap_browser(w: float, h: float, inner: str, tab_title: str) -> tuple[float, float, str]:
    tab_h, bar_h = 28, 36
    chrome_h = tab_h + bar_h
    tw = min(220.0, w * 0.4)
    parts = [
        f'<path d="M8 {chrome_h} L8 12 Q8 6 14 6 L{tw-8:.1f} 6 Q{tw-2:.1f} 6 {tw-2:.1f} 12 '
        f'L{tw-2:.1f} {tab_h-6} Q{tw-2:.1f} {tab_h} {tw+4:.1f} {tab_h} L{tw+4:.1f} {chrome_h}" '
        f'fill="#fff" stroke="{LINE}" stroke-width="1"/>',
        f'<text x="20" y="{tab_h/2+4:.1f}" font-family="Inter,Arial,sans-serif" font-size="10.5" '
        f'fill="{INK}">{tab_title}</text>',
        f'<rect x="0" y="{tab_h}" width="{w}" height="{bar_h}" fill="#fff" stroke="{LINE}" stroke-width="1"/>',
    ]
    for cx in (22, 42, 62):
        parts.append(f'<circle cx="{cx}" cy="{tab_h+bar_h/2:.1f}" r="6" fill="none" '
                     f'stroke="{LINE}" stroke-width="1.3"/>')
    ax = 90.0
    aw = max(w - ax - 16, 20.0)
    parts.append(f'<rect x="{ax}" y="{tab_h+7}" width="{aw:.1f}" height="{bar_h-14}" '
                 f'rx="{(bar_h-14)/2:.1f}" fill="{FILL}" stroke="{LINE}" stroke-width="1"/>')
    body = "".join(parts) + f'<svg x="0" y="{chrome_h}" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{inner}</svg>'
    total_h = h + chrome_h
    frame = (f'<rect width="{w}" height="{total_h:.1f}" fill="#fff" stroke="{INK}" '
             f'stroke-width="1.4"/>{body}')
    return w, total_h, frame


def wrap_mobile(w: float, h: float, inner: str, _title: str) -> tuple[float, float, str]:
    top, bottom, side, radius = 26.0, 18.0, 10.0, 22.0
    total_w, total_h = w + side * 2, h + top + bottom
    notch_w = min(70.0, total_w * 0.35)
    body = [
        f'<rect x="1" y="1" width="{total_w-2:.1f}" height="{total_h-2:.1f}" rx="{radius}" '
        f'fill="#fff" stroke="{INK}" stroke-width="2"/>',
        f'<rect x="{(total_w-notch_w)/2:.1f}" y="6" width="{notch_w:.1f}" height="9" rx="4.5" fill="{INK}"/>',
        f'<svg x="{side}" y="{top}" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{inner}</svg>',
        f'<rect x="{(total_w-56)/2:.1f}" y="{total_h-10:.1f}" width="56" height="4" rx="2" fill="{LINE}"/>',
    ]
    return total_w, total_h, "".join(body)


FRAME_WRAPPERS = {"browser": wrap_browser, "mobile": wrap_mobile}


# ---------- Композиция N кадров в один storyboard ----------

def compose(frames: list[tuple[str, float, float, str]]) -> str:
    """frames: [(подпись, w, h, inner), ...] -> холст: номер, кадр, подпись,
    стрелка к следующему кадру."""
    gap, pad_top, cap_gap, cap_line = 56, 30, 20, 15
    max_h = max(h for _, _, h, _ in frames)
    x = 16
    body = []
    centers = []
    for i, (caption, w, h, inner) in enumerate(frames, start=1):
        body.append(f'<text x="{x}" y="18" font-family="Inter,Arial,sans-serif" font-size="13" '
                    f'font-weight="800" fill="{ACC}">{i}</text>')
        fx = x + 18
        body.append(f'<svg x="{fx:.1f}" y="{pad_top}" width="{w:.1f}" height="{h:.1f}" '
                    f'viewBox="0 0 {w:.1f} {h:.1f}">{inner}</svg>')
        cap_y = pad_top + max_h + cap_gap
        if caption:
            body.append(f'<text x="{x}" y="{cap_y}" font-family="Inter,Arial,sans-serif" '
                        f'font-size="10.5" fill="{MUTED}">{html.escape(caption)}</text>')
        centers.append((x, fx + w, pad_top + h / 2))
        x = fx + w + gap
    for (_, x1, cy1), (x2, _, cy2) in zip(centers, centers[1:]):
        cy = (cy1 + cy2) / 2
        body.append(f'<path d="M{x1+6:.1f} {cy:.1f} L{x2-14:.1f} {cy:.1f}" stroke="{ACC}" '
                    f'stroke-width="1.6" fill="none" marker-end="url(#wl-ah)"/>')
    total_w = x - gap + 16
    total_h = pad_top + max_h + cap_gap + cap_line + 10
    head = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total_w:.1f} {total_h:.1f}" '
            f'width="{total_w:.1f}" height="{total_h:.1f}">'
            f'<defs><marker id="wl-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" '
            f'markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" '
            f'fill="{ACC}"/></marker></defs><rect width="{total_w:.1f}" height="{total_h:.1f}" fill="#fff"/>')
    return head + "".join(body) + "</svg>"


def render_storyboard(code: str, device: str) -> str:
    wrap = FRAME_WRAPPERS.get(device)
    if wrap is None:
        raise RenderError(f"неизвестная рамка «{device}» — ожидался browser или mobile")
    chunks = [c for c in FRAME_SPLIT_RE.split(code.strip("\n") + "\n") if c.strip()]
    if not chunks:
        raise RenderError("пустой блок wireloom-storyboard")
    frames = []
    for chunk in chunks:
        caption, sep, source = chunk.partition("\n---\n")
        if not sep:
            raise RenderError('в кадре нет разделителя "---" между подписью и исходником .wireloom')
        w, h, inner = render_frame(source.strip("\n"))
        fw, fh, finner = wrap(w, h, inner, caption.strip())
        frames.append((caption.strip(), fw, fh, finner))
    return compose(frames)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", choices=["browser", "mobile"], default="browser")
    args = ap.parse_args()
    code = sys.stdin.read()
    try:
        sys.stdout.write(render_storyboard(code, args.device))
    except RenderError as e:
        sys.stderr.write(str(e))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
