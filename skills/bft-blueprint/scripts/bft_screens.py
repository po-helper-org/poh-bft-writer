#!/usr/bin/env python3
"""Требования к экранам — заметки для дизайнера, по файлу `screens/<ID>.md` на экран истории.

Файл — обычный markdown: заметками удобно управлять в любом редакторе.

    # Заголовок экрана
    ![Подпись](screen:F3)        ← картинки экрана до первой вкладки: 0, 1 или несколько
    ## Product                   ← вкладки: Product, Design, Functions — по порядку
    ### Заголовок заметки        ← одна заметка — одно требование
    Текст заметки: абзацы, списки, **жирный**, картинки ![…](screen:F4) или ![…](файл.png).
    Источник: ФТ-1, ИТ-8

Product — job stories «Когда …, хочу …, чтобы …»; Design — где, в каком состоянии, что главное,
куда дальше, ограничения; Functions — сценарии Gherkin «**Дано** / **Когда** / **Тогда** / **И**».
Неизвестное — `[УТОЧНИТЬ у {кого}]`. Стандарт — `resources/screen_notes.md`.

  ОШИБКИ                                        ПРЕДУПРЕЖДЕНИЯ
  SN001  файл не по экрану истории              SN020  вкладка без заметок
  SN002  нет заголовка `# …`                    SN021  заметка без «Источник:» и без [УТОЧНИТЬ]
  SN003  вкладки не те, не по порядку,          SN022  Product: заметка не в форме «Когда …, хочу …»
         текст вне заметки                      SN023  экран истории без требований
  SN004  заметка без заголовка или текста,
         повтор заголовка во вкладке
  SN005  Functions: нет шага «**Тогда**»
  SN006  картинка: экрана или файла нет

Только стандартная библиотека.
"""
from __future__ import annotations

import base64
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bft_blueprint as bb  # noqa: E402

DIR = "screens"
TABS = ("Product", "Design", "Functions")
IMG_RE = re.compile(r"^!\[(.*?)\]\((.+?)\)$")
INLINE_IMG = re.compile(r"!\[(.*?)\]\((.+?)\)")
SCREEN_ID = re.compile(r"^[A-ZА-Я]\d{1,2}$")
MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml"}


@dataclass
class Note:
    tab: str
    title: str
    md: str
    line: int


@dataclass
class ScreenDoc:
    id: str
    path: Path
    title: str = ""
    images: list[tuple[str, str, int]] = field(default_factory=list)  # (подпись, источник, строка)
    notes: list[Note] = field(default_factory=list)
    text: str = ""


def parse(path: Path, issues: list) -> ScreenDoc:
    rel = f"{DIR}/{path.name}"
    doc = ScreenDoc(path.stem, path, text=path.read_text(encoding="utf-8"))
    err = lambda n, code, msg: issues.append(bb.Issue(n, "ERROR", code, msg, rel))  # noqa: E731
    tabs: list[str] = []
    tab, note, body = None, None, []

    def close():
        if note is not None:
            note.md = "\n".join(body).strip()
            if not note.md:
                err(note.line, "SN004", f"заметка «{note.title}» без текста")

    for n, raw in enumerate(doc.text.split("\n"), start=1):
        line = raw.rstrip()
        if line.startswith("### "):
            close()
            title = line[4:].strip()
            if tab is None:
                err(n, "SN003", "заметка до первой вкладки `## Product`")
            if not title:
                err(n, "SN004", "заметка без заголовка")
            elif any(x.tab == tab and x.title == title for x in doc.notes):
                err(n, "SN004", f"заметка «{title}» уже есть во вкладке {tab}")
            note, body = Note(tab or "", title, "", n), []
            doc.notes.append(note)
        elif line.startswith("## "):
            close()
            note, body = None, []
            tab = line[3:].strip()
            if tab not in TABS:
                err(n, "SN003", f"вкладка «{tab}» — одна из {', '.join(TABS)}")
            elif tab in tabs:
                err(n, "SN003", f"вкладка {tab} уже была")
            tabs.append(tab)
        elif line.startswith("# "):
            if doc.title:
                err(n, "SN002", "второй заголовок `# …` — один на экран")
            doc.title = line[2:].strip()
        elif note is not None:
            body.append(line)
        elif line.strip():
            m = IMG_RE.match(line.strip())
            if m and tab is None:
                doc.images.append((m.group(1), m.group(2), n))
            else:
                err(n, "SN003", "текст вне заметки — под `### Заголовок заметки`")
    close()
    if not doc.title:
        err(1, "SN002", "нет заголовка `# Название экрана`")
    known = [t for t in TABS if t in tabs]
    if [t for t in tabs if t in TABS] != known:
        err(1, "SN003", "вкладки по порядку: " + " → ".join(TABS))
    for t in TABS:
        if t not in tabs:
            err(1, "SN003", f"нет вкладки `## {t}`")
    return doc


def check(map_path: Path, screen_ids: set[str]) -> tuple[dict[str, ScreenDoc], list]:
    """Все файлы `screens/*.md` рядом с картой: разбор и проверка. Нет папки — нет требований (SN023)."""
    issues: list = []
    folder = map_path.parent / DIR
    docs: dict[str, ScreenDoc] = {}
    files = sorted(folder.glob("*.md")) if folder.is_dir() else []
    for f in files:
        rel = f"{DIR}/{f.name}"
        doc = parse(f, issues)
        if f.stem not in screen_ids:
            issues.append(bb.Issue(1, "ERROR", "SN001", f"экрана {f.stem} нет в истории — имя файла = ID экрана", rel))
            continue
        docs[f.stem] = doc
        for alt, src, n in doc.images + [(m.group(1), m.group(2), x.line) for x in doc.notes for m in INLINE_IMG.finditer(x.md)]:
            if src.startswith("screen:"):
                if src[7:] not in screen_ids:
                    issues.append(bb.Issue(n, "ERROR", "SN006", f"картинка «{alt}»: экрана {src[7:]} нет в истории", rel))
            elif not re.match(r"^(https?:|data:)", src) and not (f.parent / src).is_file():
                issues.append(bb.Issue(n, "ERROR", "SN006", f"картинка «{alt}»: файла {src} нет рядом с {rel}", rel))
        for t in TABS:
            if not any(x.tab == t for x in doc.notes):
                issues.append(bb.Issue(1, "WARN", "SN020", f"вкладка {t} без заметок", rel))
        for x in doc.notes:
            if x.tab == "Functions" and "**Тогда**" not in x.md:
                issues.append(bb.Issue(x.line, "ERROR", "SN005", f"«{x.title}»: сценарий без шага **Тогда**", rel))
            if "Источник:" not in x.md and bb.MARKER not in x.md and x.tab != "Design":
                issues.append(bb.Issue(x.line, "WARN", "SN021", f"«{x.title}»: нет строки «Источник:» с ID требований", rel))
            if x.tab == "Product" and not re.search(r"Когда .+хочу", x.md.replace("**", "")):
                issues.append(bb.Issue(x.line, "WARN", "SN022", f"«{x.title}»: история в форме «Когда …, хочу …, чтобы …»", rel))
    covered = set(docs) | {src[7:] for d in docs.values() for _, src, _ in d.images if src.startswith("screen:")}
    missing = sorted(screen_ids - covered)
    if missing:
        where = f"нет файлов {DIR}/<ID>.md" if not files else "нет файлов"
        issues.append(bb.Issue(1, "WARN", "SN023", f"экраны без требований для дизайнера ({where}): {', '.join(missing)}"))
    return docs, issues


def page_md(doc: ScreenDoc) -> str:
    """Текст файла для страницы: локальные картинки встроены в data: — страница остаётся одним файлом."""
    def inline(m: re.Match) -> str:
        alt, src = m.group(1), m.group(2)
        p = doc.path.parent / src
        if src.startswith(("screen:", "http:", "https:", "data:")) or not p.is_file():
            return m.group(0)
        mime = MIME.get(p.suffix.lower(), "application/octet-stream")
        return f"![{alt}](data:{mime};base64,{base64.b64encode(p.read_bytes()).decode()})"
    return INLINE_IMG.sub(inline, doc.text)
