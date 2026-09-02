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
на первое упоминание, справа — TOC по реальным <h2>, слева — выезжающая
панель быстрого обхода всех [УТОЧНИТЬ], клик по фрагменту или по выделению
текста открывает форму комментария; все комментарии собираются в промт
для ИИ в правой верхней панели.
"""
import argparse
import html as htmlmod
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

def inline(text: str, skip_id_links=False, id_map=None) -> str:
    esc = htmlmod.escape(text, quote=False)

    # `[УТОЧНИТЬ ...]` (with or without surrounding backticks) -> <mark>, single pass
    esc = re.sub(r"`?(\[УТОЧНИТЬ[^\]]*\])`?", r'<mark class="unc">\1</mark>', esc)

    # links [text](url)
    esc = re.sub(r"\[([^\]]+)\]\((https?://[^\s)]+)\)", r'<a href="\2">\1</a>', esc)
    # bold **text**
    esc = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", esc)
    # remaining inline code `x`
    esc = re.sub(r"`([^`]+)`", r"<code>\1</code>", esc)

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
        if line.startswith("#"):
            level = len(line) - len(line.lstrip("#"))
            text = line[level:].strip()
            blocks.append(("heading", level, text))
            i += 1
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
            while j < len(lines) and (re.match(r"^\d+\.\s", lines[j].strip()) or lines[j].strip().startswith(("* ", "- "))):
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
    for row in rows:
        row = row + [""] * (len(header) - len(row))
        tr_id = ""
        cells = []
        for idx, cell in enumerate(row):
            if is_id_table and idx == 0:
                slug = slug_for(cell)
                if slug:
                    tr_id = f' id="{slug}"'
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


def render_body(blocks, id_map):
    out = []
    diagram_html = None
    for kind, a, b in blocks:
        if kind == "heading":
            level, text = a, b
            if level == 1:
                continue  # title rendered separately
            if level == 2:
                out.append(f'<h2 id="">{inline(text, skip_id_links=True)}</h2>')
            else:
                out.append(f"<h{level}>{inline(text, skip_id_links=True)}</h{level}>")
        elif kind == "quote":
            out.append(f'<div class="status">{inline(b, id_map=id_map)}</div>')
        elif kind == "table":
            out.append(render_table(a, b, id_map))
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
            cls = "src" if b.startswith("Источник") else ""
            attr = f' class="{cls}"' if cls else ""
            out.append(f"<p{attr}>{inline(b, id_map=id_map)}</p>")
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

<button id="uncToggle" class="unc-tab">⟩ УТОЧНИТЬ (<span id="uncCount">0/0</span>)</button>
<div class="unc-drawer" id="uncDrawer">
  <div class="unc-drawer-head"><h4>Быстрый обход «УТОЧНИТЬ»</h4><button id="uncClose" class="unc-close" title="Закрыть">×</button></div>
  <div id="uncList"></div>
</div>

<div class="layout">
<main>

<div class="meta-line">{meta_line}</div>
<h1 id="top">{title}</h1>
"""

TEMPLATE_TAIL = """
<footer>
Документ: <code>{doc_name}</code>{lint_status}
</footer>

</main>

<nav class="toc">
<div class="toc-title">На странице</div>
<div id="tocList"></div>
</nav>

</div>

{scripts}
</body>
</html>
"""

CSS = (Path(__file__).parent / "bft-html-export.css").read_text(encoding="utf-8")
SCRIPTS = (Path(__file__).parent / "bft-html-export.js").read_text(encoding="utf-8")


def run_lint(md_path: Path) -> str:
    scripts_dir = Path(__file__).parent
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

    # assign incremental ids to h2 headings post-hoc (avoid clobbering id="" placeholder)
    counter = {"n": 0}

    def h2_id(m):
        counter["n"] += 1
        return f'<h2 id="sec-{counter["n"]}">'

    body_html = re.sub(r'<h2 id="">', h2_id, body_html)

    epic_slug = meta.get("epic_slug") or md_path.stem
    version = meta.get("version", "")
    stage = meta.get("stage", "")
    synced = meta.get("synced", "")
    meta_line = f"БФТ · {epic_slug} · v{version} · {stage} · синк {synced}"

    lint_status = run_lint(md_path)

    scripts = SCRIPTS.replace("__STORE_KEY__", f"bft-comments-{epic_slug}").replace("__DOC_NAME__", md_path.name)

    html_out = TEMPLATE_HEAD.format(title=htmlmod.escape(title), css=CSS, meta_line=htmlmod.escape(meta_line))
    html_out += body_html
    html_out += TEMPLATE_TAIL.format(doc_name=md_path.name, lint_status=lint_status, scripts=scripts)

    out_path = Path(args.output) if args.output else md_path.with_suffix(".html")
    out_path.write_text(html_out, encoding="utf-8")
    print(f"OK — записано {out_path}")


if __name__ == "__main__":
    main()
