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

# ---------- рендер ----------

def render_hypothesis(hyp: dict) -> str:
    if not hyp["blocks"] and not hyp["metric"]:
        return "<p class='pane-empty'>Гипотеза не собрана.</p>"
    rows = "".join(
        f"<tr><th>{htmlmod.escape(b['block'])}</th><td>{inline(b['text'])}"
        f"<span class='src'>{inline(b['source'])}</span></td></tr>"
        for b in hyp["blocks"]
    )
    metric = "".join(
        f"<p class='metric'><b>{htmlmod.escape(m['label'])}:</b> {inline(m['value'])}</p>"
        for m in hyp["metric"]
    )
    return f"<table class='hyp-table'><tbody>{rows}</tbody></table>{metric}"


def render_plan(sections: dict[str, list[str]]) -> str:
    goals = collect_list(sections.get("Цели интервью", []))
    rows = table_of(sections.get("План мероприятия", []))
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
        parts.append(f"<h3>Тайминг</h3><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>")
    notes = collect_paragraphs(sections.get("План мероприятия", []))
    if notes:
        parts.append("<h3>Формат</h3>" + "".join(f"<p>{inline(n)}</p>" for n in notes))
    return "".join(parts) or "<p class='pane-empty'>План не задан.</p>"


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


def render_participants(people: list[dict], questions: list[dict]) -> str:
    """Участники — не справка, а фильтр: у каждого кнопка «вести только его вопросы».

    Счётчик рядом с именем отвечает на вопрос, ради которого в список и смотрят на встрече:
    сколько ещё спрашивать этого человека, прежде чем отпустить его со звонка.
    """
    if not people:
        return "<p class='pane-empty'>Участники не названы.</p>"
    cards = []
    for person in people:
        count = sum(1 for q in questions if q["whom"] == person["name"])
        addressable = count > 0
        button = (
            f"<button type='button' class='scope-btn' data-whom=\"{htmlmod.escape(person['name'], quote=True)}\">"
            f"Вести только его вопросы ({count})</button>"
            if addressable else "<span class='scope-none'>Отдельных вопросов нет</span>"
        )
        cards.append(
            "<article class='person'>"
            f"<h3>{inline(person['name'])}</h3>"
            f"<p class='person-role'>{inline(person['role'])}</p>"
            f"<p>{inline(person['why'])}</p>"
            f"<p class='person-blocks'>{inline(person['blocks'])}</p>"
            f"{button}</article>"
        )
    return ("<button type='button' class='scope-btn scope-all' data-whom=''>Все вопросы</button>"
            + "".join(cards))


def render_questions(questions: list[dict]) -> str:
    """Карточки вопросов: все в разметке, видна одна — ей управляет опросник.

    Содержимое остаётся в HTML, а не собирается скриптом из данных: страница обязана
    читаться и без JS, иначе скрипт интервью нельзя ни распечатать, ни найти поиском.
    """
    cards = []
    for q in questions:
        ctx = [htmlmod.escape(q["stage"])]
        if q["tag"]:
            ctx.append(htmlmod.escape(q["tag"]))
        note = ""
        if q.get("hyp"):
            note += f"<p class='q-note'>{inline(q['hyp'])}</p>"
        if q.get("gap"):
            note += f"<p class='q-note q-gap'>Пробел: {inline(q['gap'])}</p>"
        whom = f"<p class='q-whom'>Вопрос к: {inline(q['whom'])}</p>" if q["whom"] else ""
        cards.append(
            f"<article class='q' id='q-{q['id']}' data-qid='{q['id']}' "
            f"data-whom=\"{htmlmod.escape(q['whom'], quote=True)}\" hidden>"
            f"<p class='q-ctx'>{' · '.join(ctx)}</p>"
            f"<h2 class='q-text'>{inline(q['text'])}</h2>"
            f"{whom}{note}"
            "<textarea class='answer' rows='4' placeholder='Ответ участника — своими словами, лучше цитатой'></textarea>"
            "<input class='who' type='text' placeholder='Кто ответил'>"
            "</article>"
        )
    return "\n".join(cards)


def render_triggers(triggers: list[dict]) -> str:
    if not triggers:
        return "<p class='pane-empty'>Подсказок нет.</p>"
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
        return "<p class='pane-empty'>Ограничений не записано.</p>"
    return "<ul class='skipped'>" + "".join(f"<li>{inline(i)}</li>" for i in items) + "</ul>"


def strip_gap_ref(text: str) -> str:
    """Цель без внутренней ссылки на пробел: письмо уходит наружу, маркеры остаются внутри."""
    return re.split(r"\s*←\s*", text)[0].strip().rstrip(".")


def build_agenda(title: str, sections: dict[str, list[str]], people: list[dict],
                 questions: list[dict]) -> str:
    """Заготовка письма участникам: зачем зовём, что обсудим, что просим принести.

    Собирается на сервере, а не в браузере: цели и вопросы уже разобраны здесь, и второй
    разбор в скрипте разошёлся бы с документом при первой же правке формата.
    """
    # Письмо уходит наружу: ни маркера артефакта, ни слага эпика в теме быть не должно —
    # получателю они ничего не говорят, а выглядят как служебный мусор.
    plain_title = re.sub(r"^\[CustDev\]\s*", "", title)
    plain_title = re.sub(r"^[a-z0-9][a-z0-9._-]*:\s*", "", plain_title)
    subject = "CustDev-интервью: " + plain_title
    goals = [strip_gap_ref(g) for g in collect_list(sections.get("Цели интервью", []))]
    plan_rows = table_of(sections.get("План мероприятия", []))
    # Тайминг — одна цифра, а не перечисление блоков: получателю нужно знать, сколько
    # держать слот, разбивка по блокам живёт в плане мероприятия.
    minutes = 0
    for row in plan_rows[1:]:
        if len(row) > 1:
            found = re.search(r"(\d+)\s*мин", row[1])
            if found:
                minutes += int(found.group(1))
    duration = f"{minutes} минут" if minutes else ""

    lines = [f"Тема: {subject}", "", "Коллеги, добрый день!", ""]
    lines.append(
        "Хочу разобраться, как процесс устроен сейчас. Готовое решение не защищаем и не "
        "обсуждаем — интересны ваши примеры из практики: что делали в последний раз, что "
        "заняло больше всего времени, где пришлось возвращаться."
    )
    lines.append("")

    if goals:
        lines.append("Цель встречи:")
        lines += [f"— {g}" for g in goals]
        lines.append("")

    lines.append("Вопросы к обсуждению:")
    script_count = sum(1 for q in questions if not q.get("hyp"))
    if script_count:
        lines.append(f"— Как процесс устроен сейчас, шаг за шагом ({script_count} вопросов по скрипту)")
    for person in people:
        # Неназванный участник (`[кому?]`) в письмо адресатом не попадает: приглашать
        # некого, и блок вопросов к нему получателя только запутает.
        if person["name"].startswith("["):
            continue
        personal = [q for q in questions if q["whom"] == person["name"] and q.get("hyp")]
        if not personal:
            continue
        lines.append("")
        lines.append(f"{person['name']} ({person['role']}):")
        lines += [f"— {q['text']}" for q in personal]
    lines.append("")

    if duration:
        lines.append(f"Тайминг: {duration}.")
    lines.append("Ничего готовить заранее не нужно — если под рукой будет пример или переписка, этого достаточно.")
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

<nav class="rail" aria-label="Материалы встречи">
  <button type="button" class="rail-tab" data-drawer="meta">Материалы</button>
  <button type="button" class="rail-tab" data-drawer="agenda">Email Agenda</button>
  <button type="button" class="rail-tab" data-drawer="hints">Подсказки</button>
  <button type="button" class="rail-tab" data-drawer="result">Результат</button>
</nav>

<aside class="drawer" id="drawer-meta" hidden>
  <header class="drawer-head">
    <h2>Материалы встречи</h2>
    <button type="button" class="drawer-close" data-close title="Закрыть">×</button>
  </header>
  <nav class="pane-tabs">
    <button type="button" data-pane="hyp" aria-pressed="true">Гипотеза</button>
    <button type="button" data-pane="plan" aria-pressed="false">План и цели</button>
    <button type="button" data-pane="people" aria-pressed="false">Участники</button>
    <button type="button" data-pane="skip" aria-pressed="false">Не спрашиваем</button>
  </nav>
  <div class="drawer-body">
    <section data-pane="hyp">{hypothesis}</section>
    <section data-pane="plan" hidden>{plan}</section>
    <section data-pane="people" hidden>{participants}</section>
    <section data-pane="skip" hidden>{skipped}</section>
  </div>
</aside>

<aside class="drawer" id="drawer-agenda" hidden>
  <header class="drawer-head">
    <h2>Письмо участникам</h2>
    <button type="button" class="drawer-close" data-close title="Закрыть">×</button>
  </header>
  <div class="drawer-body">
    <p class="hint">Заготовка приглашения. Правьте прямо здесь — кнопки берут текущий текст.</p>
    <textarea id="agendaText" rows="22">{agenda}</textarea>
    <div class="drawer-actions">
      <button type="button" id="agendaCopy">Скопировать</button>
      <button type="button" id="agendaMail">Открыть в почте</button>
    </div>
  </div>
</aside>

<aside class="drawer" id="drawer-hints" hidden>
  <header class="drawer-head">
    <h2>Уточняющие вопросы</h2>
    <button type="button" class="drawer-close" data-close title="Закрыть">×</button>
  </header>
  <div class="drawer-body">
    <p class="hint">Задаются по ходу рассказа, а не по номеру этапа.</p>
    {triggers}
  </div>
</aside>

<aside class="drawer" id="drawer-result" hidden>
  <header class="drawer-head">
    <h2>Результат встречи</h2>
    <button type="button" class="drawer-close" data-close title="Закрыть">×</button>
  </header>
  <div class="drawer-body">
    <p class="hint">Промт уходит в чат вместе с транскрибацией. Файл — архив встречи.</p>
    <textarea id="promptOut" readonly rows="18"></textarea>
    <div class="drawer-actions">
      <button type="button" id="copyBtn">Скопировать промт</button>
      <button type="button" id="downloadBtn">Скачать ответы</button>
    </div>
  </div>
</aside>

<div class="bar"><div class="bar-fill" id="barFill"></div></div>

<main class="survey">
  <div class="survey-inner">
    <p class="crumb">
      <span id="qPos">—</span>
      <span class="crumb-sep">·</span>
      <span id="qScope">все участники</span>
      <button type="button" id="scopeReset" hidden>сбросить</button>
    </p>

    <div id="questions">
{questions}
    </div>

    <section class="finish" id="finish" hidden>
      <h2 id="finishTitle">Интервью пройдено</h2>
      <p id="finishText"></p>
      <div class="finish-actions">
        <button type="button" id="finishResult">Собрать результат</button>
        <button type="button" id="finishBack">Вернуться к вопросам</button>
      </div>
    </section>
  </div>

  <footer class="survey-nav">
    <button type="button" id="prevBtn">Назад</button>
    <span class="nav-hint">Ctrl + Enter — дальше</span>
    <button type="button" id="skipBtn">Не относится</button>
    <button type="button" id="nextBtn" class="primary">Далее</button>
  </footer>
</main>

<p class="doc-foot">{title} · <code>{doc_name}</code>{lint_status}</p>

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
        plan=render_plan(sections),
        participants=render_participants(participants, questions),
        skipped=render_skipped(sections),
        triggers=render_triggers(collect_triggers(sections)),
        agenda=htmlmod.escape(build_agenda(title, sections, participants, questions)),
        questions=render_questions(questions),
        doc_name=htmlmod.escape(md_path.name),
        lint_status=run_lint(md_path),
        scripts=scripts,
    )

    out_path = Path(args.output) if args.output else md_path.with_suffix(".html")
    out_path.write_text(html_out, encoding="utf-8")
    print(f"OK — записано {out_path} · вопросов: {len(questions)} · участников: {len(participants)}")


if __name__ == "__main__":
    main()
