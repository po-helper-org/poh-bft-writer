#!/usr/bin/env python3
"""Генерирует страницу проблемного интервью рядом с `<epic>-custdev.md`.

Использование:
    python3 bft-custdev-export.py <путь-к-epic-custdev.md> [-o output.html]

Это не второй рендер документа, а **поверхность встречи**: карточка вопроса с
полем ответа, фильтр по участнику, прогресс, подсказки-триггеры уточняющих
контекстных вопросов и сборка ответов в промт для чата.

Разбор markdown (инлайн-разметка, линковка ключей трекера и pageId вики) взят из
`bft-html-export.py`: рендерер один на обе страницы, иначе они разъезжаются.

Ключ ответа — хэш текста вопроса, а не номер строки: пересобрали скрипт после
правки документа, и уже данные ответы остаются на своих вопросах, а не съезжают
на соседние.
"""
import argparse
import hashlib
import html as htmlmod
import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent


def _load_sibling(name: str, filename: str):
    """Импорт соседнего скрипта, чьё имя содержит дефис и не является идентификатором."""
    spec = importlib.util.spec_from_file_location(name, SCRIPTS_DIR / filename)
    if spec is None or spec.loader is None:
        raise SystemExit(f"не найден {filename} рядом с {Path(__file__).name} — установка неполна")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_export = _load_sibling("bft_html_export", "bft-html-export.py")
inline = _export.inline
parse_frontmatter = _export.parse_frontmatter

FLOW_VERIFY = "верификация гипотезы"
FLOW_DISCOVER = "новые знания"

CLOSING_STAGES = {"«Волшебная палочка»", "Обратный вопрос"}


def qid(text: str) -> str:
    """Идентификатор вопроса — хэш его текста, чтобы ответ пережил пересборку скрипта."""
    return hashlib.sha1(text.strip().encode("utf-8")).hexdigest()[:10]


# ---------- разбор документа ----------

def split_sections(body: str) -> dict[str, list[str]]:
    """Строки документа по разделам второго уровня. Ключ — текст заголовка без решёток."""
    sections: dict[str, list[str]] = {}
    current = None
    for line in body.split("\n"):
        if line.startswith("## "):
            current = line[3:].strip()
            sections[current] = []
        elif current is not None:
            sections[current].append(line)
    return sections


def table_of(lines: list[str]) -> list[list[str]]:
    """Строки markdown-таблицы без разделителей. Первая — заголовок."""
    rows: list[list[str]] = []
    for raw in lines:
        stripped = raw.strip()
        if not (stripped.startswith("|") and stripped.endswith("|")):
            continue
        cells = [c.strip() for c in stripped.strip("|").split("|")]
        if set("".join(cells)) <= set("-: "):
            continue
        rows.append(cells)
    return rows


def questions_of(cell: str) -> list[str]:
    return [q.strip() for q in re.split(r"<br\s*/?>", cell) if q.strip()]


TAG_RE = re.compile(r"\s*\((Поведение|Метрика блокера|Мотивация|Причина)\)\s*$")


def strip_tag(question: str) -> tuple[str, str | None]:
    m = TAG_RE.search(question)
    if not m:
        return question, None
    return question[: m.start()].strip(), m.group(1)


def collect_questions(sections: dict[str, list[str]], respondent: str) -> list[dict]:
    """Вопросы скрипта и дополнительных гипотез — единым списком карточек."""
    out: list[dict] = []

    for row in table_of(sections.get("Скрипт интервью", []))[1:]:
        if len(row) != 3:
            continue
        stage, verify, discover = row
        for flow, cell in ((FLOW_VERIFY, verify), (FLOW_DISCOVER, discover)):
            for raw in questions_of(cell):
                text, tag = strip_tag(raw)
                out.append({
                    "id": qid(text),
                    "text": text,
                    "stage": stage,
                    "flow": flow,
                    "tag": tag,
                    "whom": respondent,
                    "hyp": "",
                    "closing": stage in CLOSING_STAGES,
                })

    for row in table_of(sections.get("Дополнительные гипотезы", []))[1:]:
        if len(row) != 6:
            continue
        num, kind, formulation, gap, whom, question = row
        out.append({
            "id": qid(question),
            "text": question,
            "stage": f"Дополнительная гипотеза {num}",
            "flow": f"гипотеза {kind}",
            "tag": None,
            "whom": whom,
            "hyp": formulation,
            "gap": gap,
            "closing": False,
        })

    seen: set[str] = set()
    unique: list[dict] = []
    for item in out:
        # Один и тот же вопрос дважды — один ответ: иначе на встрече его зададут два раза,
        # а в промт он уедет с двумя разными формулировками ответа.
        if item["id"] in seen:
            continue
        seen.add(item["id"])
        unique.append(item)
    for n, item in enumerate(unique, start=1):
        item["n"] = n
    return unique


def collect_participants(sections: dict[str, list[str]]) -> list[dict]:
    people = []
    for row in table_of(sections.get("Участники", []))[1:]:
        if len(row) != 4:
            continue
        people.append({"name": row[0], "role": row[1], "why": row[2], "blocks": row[3]})
    return people


def collect_triggers(sections: dict[str, list[str]]) -> list[dict]:
    out = []
    for row in table_of(sections.get("Уточняющие контекстные вопросы", []))[1:]:
        if len(row) != 2:
            continue
        out.append({"when": row[0], "ask": [q for q in questions_of(row[1])]})
    return out


def collect_hypothesis(sections: dict[str, list[str]]) -> dict:
    blocks = []
    for row in table_of(sections.get("Гипотеза проблемы", []))[1:]:
        if len(row) != 3:
            continue
        blocks.append({"block": row[0], "text": row[1], "source": row[2]})
    metric = []
    for raw in sections.get("Гипотеза проблемы", []):
        stripped = raw.strip()
        m = re.match(r"^\*\*([^*]+):\*\*\s*(.*)$", stripped)
        if m:
            metric.append({"label": m.group(1), "value": m.group(2)})
    return {"blocks": blocks, "metric": metric}


def collect_list(lines: list[str]) -> list[str]:
    out = []
    for raw in lines:
        stripped = raw.strip()
        m = re.match(r"^(?:[*\-]|\d+\.)\s+(.*)$", stripped)
        if m and m.group(1):
            out.append(m.group(1))
    return out


# ---------- рендер ----------

def render_hypothesis(hyp: dict) -> str:
    if not hyp["blocks"] and not hyp["metric"]:
        return ""
    rows = "".join(
        f"<tr><th>{htmlmod.escape(b['block'])}</th><td>{inline(b['text'])}</td>"
        f"<td class='src'>{inline(b['source'])}</td></tr>"
        for b in hyp["blocks"]
    )
    metric = "".join(
        f"<p class='metric'><b>{htmlmod.escape(m['label'])}:</b> {inline(m['value'])}</p>"
        for m in hyp["metric"]
    )
    return (
        "<details class='hyp' open><summary>Гипотеза проблемы</summary>"
        f"<table class='hyp-table'><tbody>{rows}</tbody></table>{metric}</details>"
    )


def render_plan(sections: dict[str, list[str]]) -> str:
    rows = table_of(sections.get("План мероприятия", []))
    goals = collect_list(sections.get("Цели интервью", []))
    parts = []
    if goals:
        items = "".join(f"<li>{inline(g)}</li>" for g in goals)
        parts.append(f"<h3>Цели интервью</h3><ol class='goals'>{items}</ol>")
    if rows:
        head = "".join(f"<th>{htmlmod.escape(c)}</th>" for c in rows[0])
        body = "".join(
            "<tr>" + "".join(f"<td>{inline(c)}</td>" for c in row) + "</tr>"
            for row in rows[1:]
        )
        parts.append(f"<h3>План мероприятия</h3><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>")
    notes = [p for p in collect_paragraphs(sections.get("План мероприятия", []))]
    if notes:
        parts.append("".join(f"<p>{inline(p)}</p>" for p in notes))
    if not parts:
        return ""
    return "<details class='plan'><summary>План и цели встречи</summary>" + "".join(parts) + "</details>"


def collect_paragraphs(lines: list[str]) -> list[str]:
    out, buf = [], []
    for raw in lines:
        stripped = raw.strip()
        if stripped.startswith("|") or stripped.startswith("#"):
            continue
        if not stripped:
            if buf:
                out.append(" ".join(buf))
                buf = []
            continue
        buf.append(stripped)
    if buf:
        out.append(" ".join(buf))
    return out


def render_participants(people: list[dict]) -> str:
    if not people:
        return ""
    rows = "".join(
        f"<tr><td>{inline(p['name'])}</td><td>{inline(p['role'])}</td>"
        f"<td>{inline(p['why'])}</td><td>{inline(p['blocks'])}</td></tr>"
        for p in people
    )
    return (
        "<details class='people'><summary>Участники</summary><table><thead><tr>"
        "<th>ФИО</th><th>Роль</th><th>Зачем на интервью</th><th>Блоки вопросов</th>"
        f"</tr></thead><tbody>{rows}</tbody></table></details>"
    )


def render_cards(questions: list[dict]) -> str:
    cards = []
    for q in questions:
        meta = [f"<span class='stage'>{htmlmod.escape(q['stage'])}</span>",
                f"<span class='flow'>{htmlmod.escape(q['flow'])}</span>"]
        if q["tag"]:
            meta.append(f"<span class='tag'>{htmlmod.escape(q['tag'])}</span>")
        if q["whom"]:
            meta.append(f"<span class='whom'>{inline(q['whom'])}</span>")
        hyp = f"<p class='hyp-line'>{inline(q['hyp'])}</p>" if q.get("hyp") else ""
        gap = f"<p class='gap-line'>Пробел: {inline(q['gap'])}</p>" if q.get("gap") else ""
        cards.append(
            f"<article class='card' id='q-{q['id']}' data-qid='{q['id']}' "
            f"data-whom=\"{htmlmod.escape(q['whom'], quote=True)}\">"
            f"<header><span class='num'>{q['n']}</span><div class='meta'>{''.join(meta)}</div></header>"
            f"<p class='qtext'>{inline(q['text'])}</p>{hyp}{gap}"
            "<textarea class='answer' rows='3' placeholder='Ответ участника — своими словами, лучше цитатой'></textarea>"
            "<div class='card-foot'>"
            "<input class='who' type='text' placeholder='Кто ответил'>"
            "<button class='skip' type='button'>Не относится</button>"
            "<span class='state'></span>"
            "</div></article>"
        )
    return "\n".join(cards)


def render_triggers(triggers: list[dict]) -> str:
    if not triggers:
        return ""
    items = "".join(
        f"<li><b>{inline(t['when'])}</b>"
        + "".join(f"<span>{inline(a)}</span>" for a in t["ask"])
        + "</li>"
        for t in triggers
    )
    return f"<ul class='triggers'>{items}</ul>"


def render_skipped(sections: dict[str, list[str]]) -> str:
    items = collect_list(sections.get("Чего не спрашиваем", []))
    if not items:
        return ""
    body = "".join(f"<li>{inline(i)}</li>" for i in items)
    return f"<details class='skipped'><summary>Чего не спрашиваем</summary><ul>{body}</ul></details>"


def read_head(body: str) -> tuple[str, str]:
    """H1 и строка-пояснение под ним. Пояснение — весь абзац, а не первая строка:
    в исходнике оно перенесено по ширине, и обрыв на переносе теряет половину смысла."""
    title, lead = "", []
    for line in body.split("\n"):
        stripped = line.strip()
        if stripped.startswith("## "):
            break
        if stripped.startswith("# ") and not title:
            title = stripped[2:].strip()
            continue
        if not title or stripped.startswith("#"):
            continue
        if not stripped:
            if lead:
                break
            continue
        lead.append(stripped)
    return title, " ".join(lead)


def run_lint(md_path: Path) -> str:
    script = SCRIPTS_DIR / "bft-custdev-lint.py"
    if not script.exists():
        return ""
    try:
        res = subprocess.run(["python3", str(script), str(md_path)],
                             capture_output=True, text=True, timeout=30)
    except Exception:
        return " · гейт 22 — не прогнан"
    warns = sum(1 for line in res.stdout.splitlines() if " WARN " in line)
    status = "OK" if res.returncode == 0 else "FAIL"
    return f" · гейт 22 — {status}" + (f", предупреждений: {warns}" if warns else "")


TEMPLATE = """<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
{css}
</style>
</head>
<body>

<div class="topbar">
  <div class="progress"><b id="doneCount">0</b> из <b id="totalCount">0</b> отвечено</div>
  <div class="filters" id="filters"></div>
  <div class="actions">
    <button id="triggerBtn" type="button">Подсказки</button>
    <button id="exportBtn" type="button">Ответы и промт</button>
  </div>
</div>

<aside class="drawer" id="triggerDrawer">
  <div class="drawer-head"><h4>Уточняющие контекстные вопросы</h4>
  <button class="drawer-close" id="triggerClose" type="button" title="Закрыть">×</button></div>
  <p class="hint">Задаются по ходу рассказа, а не по номеру этапа.</p>
  {triggers}
</aside>

<aside class="drawer wide" id="exportDrawer">
  <div class="drawer-head"><h4>Результат встречи</h4>
  <button class="drawer-close" id="exportClose" type="button" title="Закрыть">×</button></div>
  <p class="hint">Промт уходит в чат вместе с транскрибацией. Файл — архив встречи.</p>
  <textarea id="promptOut" readonly rows="14"></textarea>
  <div class="drawer-actions">
    <button id="copyBtn" type="button">Скопировать промт</button>
    <button id="downloadBtn" type="button">Скачать ответы</button>
  </div>
</aside>

<main>
<h1>{title}</h1>
<p class="lead">{lead}</p>

{hypothesis}
{plan}
{participants}
{skipped}

<div class="cards" id="cards">
{cards}
</div>

<footer>Скрипт: <code>{doc_name}</code>{lint_status}</footer>
</main>

<script>
{scripts}
</script>
</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser(description="Страница проблемного интервью /bft-custdev")
    ap.add_argument("md_path")
    ap.add_argument("-o", "--output")
    args = ap.parse_args()

    md_path = Path(args.md_path)
    text = md_path.read_text(encoding="utf-8")
    meta, body = parse_frontmatter(text)
    # Служебные комментарии .md читателю невидимы, и на странице их быть не должно:
    # экранированные, они вылезли бы текстом в первый же абзац.
    body = re.sub(r"<!--.*?-->", "", body, flags=re.S)
    sections = split_sections(body)

    title, lead = read_head(body)

    respondent = meta.get("respondent", "")
    questions = collect_questions(sections, respondent)
    participants = collect_participants(sections)

    epic_slug = meta.get("epic_slug") or md_path.stem
    payload = {
        "questions": questions,
        "participants": [p["name"] for p in participants],
        "epic": epic_slug,
        "source": meta.get("source", ""),
        "prepared": meta.get("prepared", ""),
        "doc": md_path.name,
    }

    css = (SCRIPTS_DIR / "bft-html-export.css").read_text(encoding="utf-8")
    css += "\n" + (SCRIPTS_DIR / "bft-custdev-export.css").read_text(encoding="utf-8")
    scripts = (SCRIPTS_DIR / "bft-custdev-export.js").read_text(encoding="utf-8")
    # json.dumps, не подстановка в f-строку: slug и имена участников приходят из
    # frontmatter и таблицы, где кавычка или перевод строки разорвали бы литерал.
    # `</` дополнительно экранируется: текст вопроса свободный, и «</script>» внутри
    # него закрыл бы блок скрипта досрочно, оставив страницу без вопросов.
    data_json = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")
    scripts = scripts.replace("__DATA_JSON__", data_json)
    scripts = scripts.replace("__STORE_KEY_JSON__", json.dumps(f"bft-custdev-{epic_slug}"))

    html_out = TEMPLATE.format(
        title=htmlmod.escape(title),
        lead=inline(lead) if lead else "",
        css=css,
        hypothesis=render_hypothesis(collect_hypothesis(sections)),
        plan=render_plan(sections),
        participants=render_participants(participants),
        skipped=render_skipped(sections),
        triggers=render_triggers(collect_triggers(sections)),
        cards=render_cards(questions),
        doc_name=htmlmod.escape(md_path.name),
        lint_status=run_lint(md_path),
        scripts=scripts,
    )

    out_path = Path(args.output) if args.output else md_path.with_suffix(".html")
    out_path.write_text(html_out, encoding="utf-8")
    print(f"OK — записано {out_path} · вопросов: {len(questions)} · участников: {len(participants)}")


if __name__ == "__main__":
    main()
