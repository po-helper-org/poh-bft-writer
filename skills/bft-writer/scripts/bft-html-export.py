#!/usr/bin/env python3
"""Генерирует read-only HTML-версию БФТ-документа рядом с исходным .md.

Использование:
    python3 bft-html-export.py <путь-к-epic.md> [-o output.html]

Без стороннего рендера PlantUML: диаграмма из ```plantuml блока раздела
"План демонстрации" конвертируется в Mermaid sequenceDiagram (ограниченный
диалект PlantUML, который предписывают bft_standards.md/hard_gates.md —
actor-level, только ->/-->/alt/else/end/note right of, без message-схем).

Страница — статичный документ (ч/б, без промо-палитры): нумерованные ID
требований (БТ-1/ПТ-1/ИТ-1/ФТ-N/НФТ-N) становятся якорями и авто-ссылками
на первое упоминание; голый ключ трекера («GDSLV-1409») и pageId вики
(«confluence:1777883376») становятся ссылками в корпоративные системы.
Слева — рейка из двух выезжающих панелей: оглавление
по реальным <h2>/<h3> и быстрый обход всех [УТОЧНИТЬ]. Клик по точке или по
выделению текста открывает форму комментария; прокомментированная точка
становится зелёной и показывает оставленный текст по наведению. Все
комментарии собираются в промт для ИИ в правой верхней панели.
"""
import argparse
import html as htmlmod
import json
import re
import subprocess
import sys
from pathlib import Path

ID_PREFIX_SLUG = {
    "бт": "bt",
    "пт": "pt",
    "ит": "it",
    "фт": "ft",
    "нфт": "nft",
}
ID_RE = re.compile(r"\b(БТ|ПТ|ИТ|НФТ|ФТ)-(\d+)\b")


def slug_for(id_text: str) -> str:
    m = ID_RE.fullmatch(id_text.strip())
    if not m:
        return None
    prefix, num = m.group(1).lower(), m.group(2)
    return f"{ID_PREFIX_SLUG[prefix]}-{num}"


# ---------- frontmatter ----------

def parse_frontmatter(text: str):
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    fm_raw = text[3:end].strip("\n")
    rest = text[end + 4:].lstrip("\n")
    meta = {}
    for line in fm_raw.splitlines():
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        meta[k.strip()] = v.strip().strip('"')
    return meta, rest


# ---------- inline markdown ----------

# Базовые адреса корпоративных систем MTS — те же, что в bft_standards.md,
# bft-lint.py (гейт LN001/LN002) и bft-deliver-check.py.
JIRA_BROWSE = "https://jira.mts.ru/browse/"
WIKI_PAGE = "https://confluence.mts.ru/pages/viewpage.action?pageId="

# Ключ трекера: 2–10 заглавных латинских символов, дефис, номер. ID требований
# БФТ кириллические (БТ-1, ПТ-1), поэтому не пересекаются.
TRACKER_KEY_RE = re.compile(r"\b([A-Z][A-Z0-9]{1,9})-\d+\b")

# Стандарты и кодировки той же формы, что ключ трекера. Держится в паре со
# списком в bft-lint.py: там правило, здесь его отображение на странице.
NOT_TRACKER_PREFIX = frozenset({
    "UTF", "ISO", "RFC", "SHA", "MD", "HTTP", "HTTPS", "TLS", "SSL", "AES", "RSA",
    "IPV", "UTC", "GMT", "MSK", "ISBN", "ANSI", "IEEE", "PCI", "DSS", "GOST", "EN",
    "CP", "WIN", "KOI", "BASE", "SLA", "SLO", "API", "CSV", "JSON", "XML", "HTML",
    "CSS", "SQL", "PDF", "PNG", "JPEG", "GIF", "SVG",
})

# «confluence:1777883376», «Confluence 1777883376», «pageId 1777883376» — одной
# альтернативой, а не двумя проходами: второй проход поймал бы «pageId=» внутри
# ссылки, которую только что поставил первый, и вложил ссылку в ссылку.
WIKI_REF_RE = re.compile(r"\b(?:confluence\s*[:#]?\s*|pageid\s*[:=]?\s*)(\d{4,})\b", re.IGNORECASE)

# Куда линковщик не заходит: уже готовая ссылка, код-литерал и пометка
# `[УТОЧНИТЬ …]` — за последней объекта ещё нет, ссылка была бы выдуманной (ЗМ-009).
KEEP_AS_IS_RE = re.compile(
    r'(<a\b[^>]*>.*?</a>|<mark class="unc">.*?</mark>|<code>.*?</code>)', re.S)


def linkify_external(esc: str) -> str:
    """Голый ключ трекера и pageId вики → кликабельная ссылка (ЗМ-041).

    Гейт `LN001`/`LN002` не даёт голым упоминаниям попасть в новый документ, но
    страницу ревью собирают и по уже написанным — там они есть. Читателю нужен
    переход, а не сверка ключа глазами, поэтому страница линкует их сама.
    """
    parts = KEEP_AS_IS_RE.split(esc)
    for i in range(0, len(parts), 2):          # нечётные — защищённые куски
        chunk = parts[i]
        chunk = WIKI_REF_RE.sub(
            lambda m: f'<a href="{WIKI_PAGE}{m.group(1)}" class="ext-link" '
                      f'target="_blank" rel="noopener">{m.group(0)}</a>', chunk)

        def tracker(m):
            if m.group(1) in NOT_TRACKER_PREFIX:
                return m.group(0)
            return (f'<a href="{JIRA_BROWSE}{m.group(0)}" class="ext-link" '
                    f'target="_blank" rel="noopener">{m.group(0)}</a>')

        parts[i] = TRACKER_KEY_RE.sub(tracker, chunk)
    return "".join(parts)


def inline(text: str, skip_id_links=False, id_map=None) -> str:
    # quote=True (default): a literal `"` in source text must become `&quot;`
    # before the link regex below builds an href="..." attribute out of it —
    # otherwise a `"` in a URL or link text breaks out of the attribute and
    # lets arbitrary markup/attributes be injected into the exported page.
    esc = htmlmod.escape(text)

    # `[УТОЧНИТЬ ...]` (with or without surrounding backticks) -> <mark>, single pass
    esc = re.sub(r"`?(\[УТОЧНИТЬ[^\]]*\])`?", r'<mark class="unc">\1</mark>', esc)

    # links [text](url)
    esc = re.sub(r"\[([^\]]+)\]\((https?://[^\s)]+)\)", r'<a href="\2">\1</a>', esc)
    # bold **text**
    esc = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", esc)
    # remaining inline code `x`
    esc = re.sub(r"`([^`]+)`", r"<code>\1</code>", esc)
    # Голые ключи JIRA и pageId вики — после ссылок и кода: те защищают себя сами.
    esc = linkify_external(esc)

    if not skip_id_links and id_map:
        def repl(m):
            full = m.group(0)
            target = id_map.get(full)
            if not target:
                return full
            return f'<a href="#{target}" class="anchor-link">{full}</a>'
        esc = ID_RE.sub(repl, esc)

    return esc


# ---------- block parsing ----------

class Table:
    def __init__(self, header, rows):
        self.header = header
        self.rows = rows


def parse_blocks(body: str):
    lines = body.splitlines()
    blocks = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if line.startswith("```"):
            lang = line[3:].strip()
            j = i + 1
            code_lines = []
            while j < len(lines) and not lines[j].startswith("```"):
                code_lines.append(lines[j])
                j += 1
            blocks.append(("code", lang, "\n".join(code_lines)))
            i = j + 1
            continue
        if line.strip().startswith("<!--"):
            # HTML-комментарий. В markdown он читателю невидим — невидим и здесь.
            # Иначе служебные леса (строка-граница BFT-HEAD-END, комментарии
            # шаблона) вылезают на страницу ревью абзацем escape-текста.
            # Комментарий внутри ``` сюда не доходит: fenced-блок съеден выше.
            j = i
            while j < len(lines) and "-->" not in lines[j]:
                j += 1
            i = j + 1
            continue
        stripped_tag = line.strip()
        # <details>/<summary> — часть скелета открытого поля (open_field.md).
        # Без этой ветки теги уезжали на страницу видимым текстом
        # «&lt;details&gt; &lt;summary&gt;…», а блок не сворачивался вовсе.
        # Пропускаются только эти три формы: остальной HTML по-прежнему
        # экранируется, чтобы разметка из документа не ломала страницу.
        if stripped_tag in ("<details>", "</details>"):
            blocks.append(("raw", None, stripped_tag))
            i += 1
            continue
        if stripped_tag.startswith("<summary>") and stripped_tag.endswith("</summary>"):
            blocks.append(("summary", None, stripped_tag[len("<summary>"):-len("</summary>")]))
            i += 1
            continue
        if line.startswith("#"):
            level = len(line) - len(line.lstrip("#"))
            text = line[level:].strip()
            blocks.append(("heading", level, text))
            i += 1
            continue
        # Заголовок-подчёркивание (setext): канон MTS размечает свои разделы
        # именно так — «Функциональные требования*», а под ним строка «====».
        # Без этой ветки раздел канона уезжал на страницу абзацем вместе с
        # подчёркиванием («План демонстрации ====…»), не попадал в оглавление
        # и не опознавался как секция при подписи комментария — замечание к
        # требованию подписывалось «Шапка».
        # Уровень 2, а не 1: H1 занят заголовком документа и рендерится отдельно.
        # Вариант с «----» намеренно не поддержан — он неотличим от
        # горизонтальной черты и от разделителя строк таблицы.
        underline = lines[i + 1].strip() if i + 1 < len(lines) else ""
        if (not line.startswith(("|", ">")) and underline
                and set(underline) == {"="} and len(underline) >= 3):
            blocks.append(("heading", 2, line.strip()))
            i += 2
            continue
        if line.startswith(">"):
            blocks.append(("quote", None, line.lstrip(">").strip()))
            i += 1
            continue
        if line.strip().startswith("|"):
            j = i
            table_lines = []
            while j < len(lines) and lines[j].strip().startswith("|"):
                table_lines.append(lines[j])
                j += 1
            if len(table_lines) >= 2:
                header = [c.strip() for c in table_lines[0].strip().strip("|").split("|")]
                rows = []
                for row_line in table_lines[2:]:
                    rows.append([c.strip() for c in row_line.strip().strip("|").split("|")])
                blocks.append(("table", header, rows))
            i = j
            continue
        if re.match(r"^\d+\.\s", line.strip()) or line.strip().startswith(("* ", "- ")):
            j = i
            item_lines = []
            ordered = re.match(r"^\d+\.\s", line.strip()) is not None
            # only continue matching the same list type the block started with —
            # an adjacent numbered/bulleted line with no blank line between them
            # starts a new block, it doesn't silently join this one under the
            # first line's type.
            while j < len(lines) and (
                re.match(r"^\d+\.\s", lines[j].strip()) if ordered
                else lines[j].strip().startswith(("* ", "- "))
            ):
                item_lines.append(re.sub(r"^(\d+\.\s|\*\s|-\s)", "", lines[j].strip()))
                j += 1
            blocks.append(("list", ordered, item_lines))
            i = j
            continue
        # paragraph: gather until blank line
        j = i
        para_lines = []
        while j < len(lines) and lines[j].strip():
            para_lines.append(lines[j].strip())
            j += 1
        blocks.append(("para", None, " ".join(para_lines)))
        i = j
    return blocks


# ---------- PlantUML -> Mermaid ----------

def plantuml_to_mermaid(src: str) -> str:
    lines = [l.rstrip() for l in src.splitlines()]
    out = ["sequenceDiagram"]
    in_note = False
    note_target = None
    note_buf = []

    def flush_note():
        nonlocal in_note, note_target, note_buf
        if in_note and note_target:
            text = " ".join(x.strip() for x in note_buf if x.strip())
            text = text.replace("[УТОЧНИТЬ", "УТОЧНИТЬ").replace("]", "")
            out.append(f"    Note right of {note_target}: {text}")
        in_note = False
        note_target = None
        note_buf = []

    for raw in lines:
        line = raw.strip()
        if not line or line in ("@startuml", "@enduml"):
            continue
        m = re.match(r'^(actor|participant)\s+"([^"]+)"\s+as\s+(\S+)$', line)
        if m:
            kind, label, alias = m.groups()
            out.append(f"    {kind} {alias} as {label}")
            continue
        m = re.match(r"^(actor|participant)\s+(\S+)$", line)
        if m:
            kind, alias = m.groups()
            out.append(f"    {kind} {alias}")
            continue
        if line.startswith("note right of"):
            note_target = line.split("of", 1)[1].strip()
            in_note = True
            note_buf = []
            continue
        if line == "end note":
            flush_note()
            continue
        if in_note:
            note_buf.append(line)
            continue
        m = re.match(r"^(\S+)\s*-->\s*(\S+)\s*:\s*(.+)$", line)
        if m:
            a, b, txt = m.groups()
            out.append(f"    {a}-->>{b}: {txt}")
            continue
        m = re.match(r"^(\S+)\s*->\s*(\S+)\s*:\s*(.+)$", line)
        if m:
            a, b, txt = m.groups()
            out.append(f"    {a}->>{b}: {txt}")
            continue
        m = re.match(r"^(alt|else)\s*(.*)$", line)
        if m:
            kw, rest = m.groups()
            out.append(f"    {kw} {rest}".rstrip())
            continue
        if line == "end":
            out.append("    end")
            continue
        # unrecognised line — keep visible as a comment, don't drop silently
        out.append(f"    %% {line}")
    return "\n".join(out)


# ---------- rendering ----------

def render_table(header, rows, id_map):
    is_id_table = header and header[0].strip().lower() in ("идентификатор", "id")
    thead = "<thead><tr>" + "".join(f"<th>{htmlmod.escape(h)}</th>" for h in header) + "</tr></thead>"
    body_rows = []
    seen_slugs = set()
    for row in rows:
        row = row + [""] * (len(header) - len(row))
        tr_id = ""
        cells = []
        for idx, cell in enumerate(row):
            if is_id_table and idx == 0:
                slug = slug_for(cell)
                # A duplicated requirement ID in the source table (data-quality
                # slip) must not produce two <tr id="..."> with the same id —
                # invalid HTML, and anchors/CSS :target would only ever resolve
                # to the first one. Only the first occurrence gets the id.
                if slug and slug not in seen_slugs:
                    tr_id = f' id="{slug}"'
                    seen_slugs.add(slug)
                cells.append(f'<td class="rid">{htmlmod.escape(cell)}</td>')
            else:
                cells.append(f"<td>{inline(cell, id_map=id_map)}</td>")
        body_rows.append(f"<tr{tr_id}>" + "".join(cells) + "</tr>")
    return f'<div class="table-wrap"><table>{thead}<tbody>{"".join(body_rows)}</tbody></table></div>'


def collect_id_map(blocks):
    id_map = {}
    for kind, a, b in blocks:
        if kind == "table" and a and a[0].strip().lower() in ("идентификатор", "id"):
            for row in b:
                if row:
                    slug = slug_for(row[0])
                    if slug:
                        id_map[row[0].strip()] = slug
    return id_map


SRC_LEAD_RE = re.compile(r"^Источник[а-я]*\s*\(цитат[аы]\)\s*([А-Я]{2,3}-\d+)?\s*:\s*(.*)$", re.S)
SRC_ID_RE = re.compile(r"^\s*([А-Я]{2,3}-\d+(?:\s*,\s*[А-Я]{2,3}-\d+)*)\s*[—-]\s*(.+)$", re.S)
SRC_SPLIT_RE = re.compile(r";\s*(?=[А-Я]{2,3}-\d+(?:\s*,\s*[А-Я]{2,3}-\d+)*\s*[—-])")


def render_source_block(text, last_table_ids, id_map):
    """Render an 'Источник (цитата) ...' paragraph, attributing each quote to
    its requirement ID when the text names one (`ФТ-1 — PO: «...»; ФТ-2 — ...`),
    falling back to the single row of the preceding table when unambiguous,
    and never inventing an attribution otherwise."""
    m = SRC_LEAD_RE.match(text)
    lead_id, rest = (m.group(1), m.group(2)) if m else (None, text)

    segments = SRC_SPLIT_RE.split(rest)
    parsed = []
    any_matched = False
    for seg in segments:
        seg = seg.strip()
        mm = SRC_ID_RE.match(seg)
        if mm:
            any_matched = True
            ids = [x.strip() for x in mm.group(1).split(",")]
            parsed.append((ids, mm.group(2).strip()))
        else:
            parsed.append((None, seg))

    if any_matched:
        parts = []
        for ids, body in parsed:
            if ids:
                parts.append(f'<p class="src"><b>Источник для {", ".join(ids)}:</b> {inline(body, id_map=id_map)}</p>')
            else:
                parts.append(f'<p class="src">{inline(body, id_map=id_map)}</p>')
        return "\n".join(parts)

    if lead_id:
        return f'<p class="src"><b>Источник для {lead_id}:</b> {inline(rest, id_map=id_map)}</p>'

    if last_table_ids and len(last_table_ids) == 1:
        return f'<p class="src"><b>Источник для {last_table_ids[0]}:</b> {inline(rest, id_map=id_map)}</p>'

    return f'<p class="src">{inline(text, id_map=id_map)}</p>'


# Разделы, которые адресованы следующему прогону, а не читателю документа:
# открытое поле стадии fast и его пост-deep продолжение. На странице ревью они
# сворачиваются — PO раскрывает их, только если собирается продолжать работу.
FOLDABLE_SECTIONS = ("Продолжить / уточнить БФТ", "Полный БФТ — в проработке")


def fold_service_sections(body_html: str) -> str:
    """Сворачивает служебные разделы в <details>, оставляя заголовок видимым.

    H1-заголовок остаётся внутри <summary> вместе со своим id: по нему ведёт
    оглавление, и подмена его на голый текст оборвала бы навигацию.
    Вложенный <details> с промтом раскрывается сразу — иначе до промта пришлось
    бы кликать дважды.
    """
    for name in FOLDABLE_SECTIONS:
        m = re.search(r'<h2 id="sec-\d+">[^<]*' + re.escape(name) + r'[^<]*</h2>', body_html)
        if not m:
            continue
        nxt = body_html.find("<h2 ", m.end())
        end = nxt if nxt != -1 else len(body_html)
        inner = body_html[m.end():end].replace("<details>", "<details open>")
        body_html = (body_html[:m.start()]
                     + f'<details class="fold"><summary>{m.group(0)}</summary>{inner}</details>'
                     + body_html[end:])
    return body_html


def render_body(blocks, id_map):
    out = []
    last_table_ids = []
    for kind, a, b in blocks:
        if kind == "heading":
            level, text = a, b
            if level == 1:
                continue  # title rendered separately
            if level in (2, 3):
                out.append(f'<h{level} id="">{inline(text, skip_id_links=True)}</h{level}>')
            else:
                out.append(f"<h{level}>{inline(text, skip_id_links=True)}</h{level}>")
        elif kind == "raw":
            out.append(b)
        elif kind == "summary":
            out.append(f"<summary>{inline(b, skip_id_links=True)}</summary>")
        elif kind == "quote":
            out.append(f'<blockquote class="quote">{inline(b, id_map=id_map)}</blockquote>')
        elif kind == "table":
            out.append(render_table(a, b, id_map))
            if a and a[0].strip().lower() in ("идентификатор", "id"):
                last_table_ids = [row[0].strip() for row in b if row and slug_for(row[0])]
            else:
                last_table_ids = []
        elif kind == "list":
            tag = "ol" if a else "ul"
            items = "".join(f"<li>{inline(x, id_map=id_map)}</li>" for x in b)
            out.append(f"<{tag}>{items}</{tag}>")
        elif kind == "code":
            lang, code = a, b
            if lang == "plantuml":
                mermaid = plantuml_to_mermaid(code)
                out.append(f'<pre class="mermaid">\n{htmlmod.escape(mermaid)}\n</pre>')
            elif lang == "mermaid":
                out.append(f'<pre class="mermaid">\n{htmlmod.escape(code)}\n</pre>')
            else:
                out.append(f'<pre><code>{htmlmod.escape(code)}</code></pre>')
        elif kind == "para":
            if b.startswith("Источник"):
                out.append(render_source_block(b, last_table_ids, id_map))
            else:
                out.append(f"<p>{inline(b, id_map=id_map)}</p>")
    return "\n".join(out)


TEMPLATE_HEAD = """<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
<style>
{css}
</style>
</head>
<body>

<div class="promptbox">
  <button id="panelToggle">Комментарии (<span id="cCount">0</span>)</button>
  <div class="panel" id="panel">
    <h4>Комментарии к доработке</h4>
    <div id="itemsList"><p class="empty">Комментариев нет.</p></div>
    <h4 style="margin-top:1rem">Промт для ИИ</h4>
    <textarea id="promptOut" readonly></textarea>
    <button class="copybtn" id="copyBtn">Скопировать промт</button>
  </div>
</div>

<div class="rail">
  <button id="navToggle" class="rail-tab nav-tab" type="button">☰ Содержание</button>
  <button id="uncToggle" class="rail-tab unc-tab" type="button">⟩ УТОЧНИТЬ (<span id="uncCount">0/0</span>)</button>
</div>

<div class="drawer nav-drawer" id="navDrawer">
  <div class="drawer-head"><h4>Содержание</h4><button id="navClose" class="drawer-close" type="button" title="Закрыть">×</button></div>
  <div id="tocList"></div>
</div>

<div class="drawer unc-drawer" id="uncDrawer">
  <div class="drawer-head"><h4>Быстрый обход «УТОЧНИТЬ»</h4><button id="uncClose" class="drawer-close" type="button" title="Закрыть">×</button></div>
  <div id="uncList"></div>
</div>

<div class="layout">
<main>

<h1 id="top">{title}</h1>
"""

TEMPLATE_TAIL = """
<footer>
Документ: <code>{doc_name}</code>{lint_status}
</footer>

</main>
</div>

{scripts}
</body>
</html>
"""

CSS = (Path(__file__).parent / "bft-html-export.css").read_text(encoding="utf-8")
SCRIPTS = (Path(__file__).parent / "bft-html-export.js").read_text(encoding="utf-8")


def find_lint_scripts_dir(md_path: Path) -> Path:
    """Prefer the bft-lint.py that ships with the consumer project next to the
    document (it's the authoritative template version for that document) over
    the copy bundled with this exporter — the two can drift (root vs submodule
    vs project-local skill copies), and running the wrong one produces a FAIL
    that has nothing to do with the document's actual quality."""
    rel_candidates = (
        Path(".claude/skills/bft-writer/scripts"),
        Path("skills/bft-writer/scripts"),
    )
    cur = md_path.resolve().parent
    for _ in range(12):
        for rel in rel_candidates:
            candidate = cur / rel
            if (candidate / "bft-lint.py").exists():
                return candidate
        if cur.parent == cur:
            break
        cur = cur.parent
    return Path(__file__).parent


def run_lint(md_path: Path) -> str:
    scripts_dir = find_lint_scripts_dir(md_path)
    parts = []
    for name, gate in (("bft-lint.py", "17"), ("bft-style-lint.py", "18")):
        script = scripts_dir / name
        if not script.exists():
            continue
        try:
            res = subprocess.run(["python3", str(script), str(md_path)], capture_output=True, text=True, timeout=30)
            ok = res.returncode == 0
            parts.append(f"гейт {gate} — {'OK' if ok else 'FAIL'}")
        except Exception:
            parts.append(f"гейт {gate} — не прогнан")
    return " · " + " · ".join(parts) if parts else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("md_path")
    ap.add_argument("-o", "--output")
    args = ap.parse_args()

    md_path = Path(args.md_path)
    text = md_path.read_text(encoding="utf-8")
    meta, body = parse_frontmatter(text)
    blocks = parse_blocks(body)

    title = ""
    for kind, a, b in blocks:
        if kind == "heading" and a == 1:
            title = b
            break

    id_map = collect_id_map(blocks)
    body_html = render_body(blocks, id_map)

    # Сквозная нумерация якорей по h2 и h3 разом: оглавление в левой панели
    # строится из обоих уровней, а на подзаголовок без id сослаться нечем.
    counter = {"n": 0}

    def head_id(m):
        counter["n"] += 1
        return f'<h{m.group(1)} id="sec-{counter["n"]}">'

    body_html = re.sub(r'<h([23]) id="">', head_id, body_html)
    body_html = fold_service_sections(body_html)

    epic_slug = meta.get("epic_slug") or md_path.stem

    lint_status = run_lint(md_path)

    # json.dumps, not str.replace with an f-string: epic_slug (frontmatter,
    # user-editable) and the filename can contain a `"`/`\`/newline, which
    # would otherwise break out of the `var X = "...";` JS string literal.
    scripts = SCRIPTS.replace(
        "__STORE_KEY_JSON__", json.dumps(f"bft-comments-{epic_slug}")
    ).replace(
        "__DOC_NAME_JSON__", json.dumps(md_path.name)
    )

    html_out = TEMPLATE_HEAD.format(title=htmlmod.escape(title), css=CSS)
    html_out += body_html
    html_out += TEMPLATE_TAIL.format(doc_name=htmlmod.escape(md_path.name), lint_status=lint_status, scripts=scripts)

    out_path = Path(args.output) if args.output else md_path.with_suffix(".html")
    out_path.write_text(html_out, encoding="utf-8")
    print(f"OK — записано {out_path}")


if __name__ == "__main__":
    main()
