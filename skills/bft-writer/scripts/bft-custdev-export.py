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


# Тег блока гипотезы в конце вопроса: на странице он не показывается, но снять его
# с текста нужно — иначе он прозвучит вслух вместе с вопросом.
TAG_RE = re.compile(r"\s*\((Поведение|Метрика блокера|Мотивация|Причина)\)\s*$")


def strip_tag(question: str) -> tuple[str, str | None]:
    m = TAG_RE.search(question)
    if not m:
        return question, None
    return question[: m.start()].strip(), m.group(1)


def collect_questions(sections: dict[str, list[str]], respondent: str) -> list[dict]:
    """Вопросы интервью одной таблицей: `# | Вопрос | Что хотим узнать | Кому | Пробел`."""
    out: list[dict] = []
    for row in table_of(sections.get("Вопросы", []))[1:]:
        if len(row) != 5:
            continue
        num, raw, intent, whom, gap = row
        text, tag = strip_tag(raw)
        out.append({
            "id": qid(text),
            "num": num,
            "text": text,
            "tag": tag,
            "intent": intent,
            "whom": whom or respondent,
            "gap": gap,
        })
    for n, item in enumerate(out, start=1):
        item["n"] = n
    return out


def collect_participants(sections: dict[str, list[str]]) -> list[dict]:
    people = []
    for row in table_of(sections.get("Участники", []))[1:]:
        if len(row) != 3:
            continue
        people.append({"name": row[0], "role": row[1], "want": row[2]})
    return people


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

# ---------- рендер ----------

def render_hypothesis(hyp: dict) -> str:
    """Гипотеза на странице — четыре строки и метрика. Источники остаются в документе.

    Колонку «Источник» страница не показывает: на встрече её не читают, а цитата рядом с
    формулировкой удваивает текст. Грундинг от этого не слабеет — он проверяется гейтом 22
    по `.md`, где источник на месте.
    """
    if not hyp["blocks"] and not hyp["metric"]:
        return "<p class='pane-empty'>Гипотеза не собрана.</p>"
    rows = "".join(
        f"<tr><th>{htmlmod.escape(b['block'])}</th><td>{inline(b['text'])}</td></tr>"
        for b in hyp["blocks"]
    )
    metric = "".join(
        f"<p class='metric'><b>{htmlmod.escape(m['label'])}:</b> {inline(m['value'])}</p>"
        for m in hyp["metric"]
    )
    return f"<table class='hyp-table'><tbody>{rows}</tbody></table>{metric}"


def render_goals(sections: dict[str, list[str]]) -> str:
    """Цели списком. Тайминга и формата на странице нет — они не помогают вести разговор."""
    goals = collect_list(sections.get("Цели интервью", []))
    if not goals:
        return "<p class='pane-empty'>Цели не заданы.</p>"
    items = "".join(f"<li>{inline(strip_gap_ref(g))}</li>" for g in goals)
    return f"<ul class='goals'>{items}</ul>"


def render_participants(people: list[dict]) -> str:
    if not people:
        return "<p class='pane-empty'>Участники не названы.</p>"
    return "".join(
        "<article class='person'>"
        f"<h3>{inline(p['name'])}</h3>"
        f"<p class='person-role'>{inline(p['role'])}</p>"
        f"<p>{inline(p['want'])}</p>"
        "</article>"
        for p in people
    )


def render_questions(questions: list[dict]) -> str:
    """Карточки вопросов: все в разметке, видна одна — ей управляет опросник.

    Служебной строки «этап · тег» на карточке нет: на встрече она не помогает задать
    вопрос, а место занимает. Тег живёт в документе и в панели навигации.
    """
    cards = []
    for q in questions:
        intent = f"<p class='q-intent'>{inline(q['intent'])}</p>" if q["intent"] else ""
        whom = f"<p class='q-whom'>{inline(q['whom'])}</p>" if q["whom"] else ""
        cards.append(
            f"<article class='q' id='q-{q['id']}' data-qid='{q['id']}' "
            f"data-whom=\"{htmlmod.escape(q['whom'], quote=True)}\" hidden>"
            f"<h2 class='q-text'>{inline(q['text'])}</h2>"
            f"{intent}{whom}"
            "<textarea class='answer' rows='4' placeholder='Ответ — своими словами, лучше цитатой'></textarea>"
            "<input class='who' type='text' placeholder='Кто ответил'>"
            "</article>"
        )
    return "\n".join(cards)


def render_nav(questions: list[dict]) -> str:
    """Список вопросов для правой панели: прыжок к любому без прохода по всем."""
    items = "".join(
        f"<li><button type='button' class='nav-item' data-qid='{q['id']}'>"
        f"<span class='nav-num'>{q['num']}</span>"
        f"<span class='nav-text'>{inline(q['text'])}</span>"
        f"<span class='nav-state' aria-hidden='true'></span></button></li>"
        for q in questions
    )
    return f"<ol class='nav-list'>{items}</ol>"


def strip_gap_ref(text: str) -> str:
    """Цель без внутренней ссылки на пробел: письмо уходит наружу, маркеры остаются внутри."""
    return re.split(r"\s*←\s*", text)[0].strip().rstrip(".")


def build_agenda(title: str, sections: dict[str, list[str]], people: list[dict],
                 questions: list[dict]) -> str:
    """Заготовка письма участникам: зачем зовём и что спросим.

    Регистр терсый (`../../bft-custdev/resources/script_stages.md` §«Регистр текста»):
    письмо читают между делом, вводные и связки в нём только мешают. Внутренние маркеры
    наружу не уходят — ни ссылка на пробел, ни слаг эпика, ни `[кому?]`.
    """
    plain_title = re.sub(r"^\[CustDev\]\s*", "", title)
    plain_title = re.sub(r"^[a-z0-9][a-z0-9._-]*:\s*", "", plain_title)
    goals = [strip_gap_ref(g) for g in collect_list(sections.get("Цели интервью", []))]

    lines = ["Тема: CustDev — " + plain_title, "", "Коллеги, привет!", ""]
    lines.append("Зову на короткий разговор: 10 минут, без подготовки.")
    lines.append("Решение не обсуждаем. Нужны примеры из практики: как было в последний раз.")
    lines.append("")

    if goals:
        lines.append("Что выясняем:")
        lines += ["— " + g for g in goals]
        lines.append("")

    lines.append("Вопросы:")
    for person in people:
        # Неназванный участник (`[кому?]`) адресатом не бывает: приглашать некого.
        if person["name"].startswith("["):
            continue
        personal = [q for q in questions if q["whom"] == person["name"]]
        if not personal:
            continue
        lines.append("")
        lines.append(person["name"] + ":")
        lines += ["— " + q["text"] for q in personal]
    lines.append("")
    lines.append("Спасибо!")
    return "\n".join(lines)


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

<nav class="rail" aria-label="Материалы встречи">
  <button type="button" class="rail-tab" data-drawer="meta">Материалы</button>
  <button type="button" class="rail-tab" data-drawer="agenda">Email Agenda</button>
</nav>

<aside class="drawer" id="drawer-meta" hidden>
  <header class="drawer-head">
    <h2>Материалы</h2>
    <button type="button" class="drawer-close" data-close title="Закрыть">×</button>
  </header>
  <nav class="pane-tabs">
    <button type="button" data-pane="hyp" aria-pressed="true">Гипотеза</button>
    <button type="button" data-pane="goals" aria-pressed="false">Цели</button>
    <button type="button" data-pane="people" aria-pressed="false">Участники</button>
  </nav>
  <div class="drawer-body">
    <section data-pane="hyp">{hypothesis}</section>
    <section data-pane="goals" hidden>{goals}</section>
    <section data-pane="people" hidden>{participants}</section>
  </div>
</aside>

<aside class="drawer" id="drawer-agenda" hidden>
  <header class="drawer-head">
    <h2>Письмо участникам</h2>
    <button type="button" class="drawer-close" data-close title="Закрыть">×</button>
  </header>
  <div class="drawer-body">
    <textarea id="agendaText" rows="20">{agenda}</textarea>
    <div class="drawer-actions">
      <button type="button" id="agendaCopy">Скопировать</button>
      <button type="button" id="agendaMail">Открыть в почте</button>
    </div>
  </div>
</aside>

<button type="button" class="nav-toggle" id="navToggle" aria-expanded="false">Вопросы</button>

<aside class="nav-panel" id="navPanel" hidden aria-label="Навигация по вопросам">
  <header class="drawer-head">
    <h2><span id="navDone">0</span> из <span id="navTotal">0</span></h2>
    <button type="button" class="drawer-close" id="navClose" title="Закрыть">×</button>
  </header>
  <div class="drawer-body">
{nav}
  </div>
</aside>

<div class="bar"><div class="bar-fill" id="barFill"></div></div>

<main class="survey">
  <div class="survey-inner">
    <div id="questions">
{questions}
    </div>

    <section class="finish" id="finish" hidden>
      <h2>Готово</h2>
      <p id="finishText"></p>
      <textarea id="promptOut" readonly rows="12"></textarea>
      <div class="finish-actions">
        <button type="button" id="copyBtn">Скопировать промт</button>
        <button type="button" id="downloadBtn">Скачать ответы</button>
        <button type="button" id="finishBack">К вопросам</button>
      </div>
    </section>
  </div>

  <footer class="survey-nav">
    <button type="button" id="prevBtn">Назад</button>
    <span class="nav-hint">Ctrl + Enter — дальше</span>
    <button type="button" id="skipBtn">Пропустить</button>
    <button type="button" id="nextBtn" class="primary">Далее</button>
  </footer>
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
    # Служебные комментарии .md читателю невидимы, и на странице их быть не должно.
    body = re.sub(r"<!--.*?-->", "", body, flags=re.S)
    sections = split_sections(body)

    title, _lead = read_head(body)
    respondent = meta.get("respondent", "")
    questions = collect_questions(sections, respondent)
    participants = collect_participants(sections)

    epic_slug = meta.get("epic_slug") or md_path.stem
    payload = {
        "questions": questions,
        "epic": epic_slug,
        "source": meta.get("source", ""),
        "prepared": meta.get("prepared", ""),
        "doc": md_path.name,
    }

    css = (SCRIPTS_DIR / "bft-custdev-export.css").read_text(encoding="utf-8")
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
        css=css,
        hypothesis=render_hypothesis(collect_hypothesis(sections)),
        goals=render_goals(sections),
        participants=render_participants(participants),
        agenda=htmlmod.escape(build_agenda(title, sections, participants, questions)),
        nav=render_nav(questions),
        questions=render_questions(questions),
        scripts=scripts,
    )

    out_path = Path(args.output) if args.output else md_path.with_suffix(".html")
    out_path.write_text(html_out, encoding="utf-8")
    print(f"OK — записано {out_path} · вопросов: {len(questions)} · участников: {len(participants)}")


if __name__ == "__main__":
    main()
