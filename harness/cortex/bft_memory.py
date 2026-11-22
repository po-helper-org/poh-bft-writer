#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Память агента bft-creator (ADR-0016): vault poh-cortex, который читает Кортекс коробки.

Коробка не зависит от агентов вокруг неё: в память попадает только то, что
владелец явно указал, — файлы на диске. Утилита наполняет vault из них и ничего
не знает о том, кто эти файлы пишет.

  init     ROOT [--name bft-creator]           vault из шаблона poh-cortex + Нексусы памяти
  glossary ROOT FILE.json                      словарь {термин: {meaning, deleted?}} → glossary
  doc      ROOT FILE.md --id ID [--nexus landscape --type system-component]
                                               один документ (IT-карта) → один узел
  bft      ROOT FILE.md…                       итоговые БФТ прошлых заявок → bft-archive
  curated  ROOT DIR…                           готовые узлы (разбор прошлых БФТ) → NEXUS,
                                               дубли по node_id сливаются
  check    ROOT                                гейт Кортекса и счётчики по Нексусам

Импорт идемпотентный: файл узла переписывается, только если изменился (Кортекс
пересобирает индекс по времени изменения GROUND). Узлы glossary/doc/bft несут
origin: import:<вид>; повторный импорт удаляет свои узлы, которых больше нет в
источнике, и не трогает остальные.

Всё, что ложится в vault, проходит фильтр: IP-адреса, почты, телефоны, длинные
токены и строки вида «пароль: …» вырезаются. Память показывается заказчику и
уходит в модель — секретам и контактам в ней не место.
"""
from __future__ import annotations

import argparse
import datetime as dt
import importlib.machinery
import importlib.util
import json
import pathlib
import re
import shutil
import sys

TEMPLATE = pathlib.Path("/opt/poh-cortex")
NAME = "bft-creator"
NEXUSES = {
    "domains": '{slug: domains, source: custom, name: Домены и контрагенты, scope: org, shared: true, owner: bft-creator, change_rate: medium, node_types: [domain], purpose: "границы команд и подразделений, партнёры и заказчики"}',
    "glossary": '{slug: glossary, source: custom, name: Термины, scope: org, shared: true, owner: bft-creator, change_rate: low, node_types: [term], purpose: "термины и сокращения предметной области"}',
    "bft-archive": '{slug: bft-archive, source: custom, name: Архив БФТ, scope: org, shared: true, owner: bft-creator, change_rate: low, node_types: [precedent], purpose: "итоговые БФТ прошлых заявок — образцы домена, систем и терминов"}',
}
CURATED_NEXUSES = {"landscape", "processes", "team", "domains", "glossary"}
REQUIRED = ("nexus", "node_id", "node_type", "kind", "owner", "sources", "updated", "title")
LISTS = ("sources", "aliases", "tags", "where_to_check", "environments", "influence_zones", "contact_for")
BFT_BODY_LIMIT = 6000

# ──────────────────────────────────────────────────────────────────────────────
# фильтр: секреты и контакты в память не попадают
# ──────────────────────────────────────────────────────────────────────────────

_SECRET_LINE = re.compile(r"(?i)(пароль|password|passwd|token|токен|secret|секрет|api[_-]?key|totp)\s*[:=]")
_PATTERNS = [
    re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b"),                      # IPv4
    re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"),                               # почта
    re.compile(r"(?<![\w])(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}\b"),  # телефон РФ
    # длинный токен: буквы и цифры вперемешку (id узлов «proc-…» — слова через дефис, не токены)
    re.compile(r"\b(?=[A-Za-z0-9_\-]*\d)(?=[A-Za-z0-9_\-]*[A-Za-z])(?![a-z]+(?:-[a-z0-9]+)+\b)[A-Za-z0-9_\-]{32,}\b"),
]


def sanitize(text: str) -> str:
    lines = [line for line in str(text).splitlines() if not _SECRET_LINE.search(line)]
    out = "\n".join(lines)
    for pattern in _PATTERNS:
        out = pattern.sub("", out)
    return out


def clean_value(value: str) -> str:
    """Значение шапки: одна строка, без двойных кавычек (флоу-списки Кортекса их не экранируют)."""
    value = sanitize(value)
    value = re.sub(r"\s+", " ", value).strip()
    return value.replace('"', "«").replace("'", "’")


# ──────────────────────────────────────────────────────────────────────────────
# идентификаторы и файлы узлов
# ──────────────────────────────────────────────────────────────────────────────

_TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z", "и": "i",
    "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t",
    "у": "u", "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "",
    "э": "e", "ю": "yu", "я": "ya",
}


def slug(text: str) -> str:
    low = "".join(_TRANSLIT.get(ch, ch) for ch in str(text).lower())
    return re.sub(r"[^a-z0-9]+", "-", low).strip("-") or "x"


# Служебные поля — идентификаторы, их не фильтруем (фильтр не должен ломать узел).
_KEYS = {"nexus", "node_id", "node_type", "kind", "origin", "status", "ripeness", "change_rate", "updated"}


def dump(fm: dict, body: str) -> str:
    lines = ["---"]
    for key, value in fm.items():
        if value is None or value == [] or value == "":
            continue
        if key in _KEYS:
            if not re.fullmatch(r"[\w.:-]+", str(value)):
                raise ValueError(f"{key}: недопустимое значение {value!r}")
            lines.append(f"{key}: {json.dumps(str(value))}")
            continue
        if isinstance(value, (list, tuple)):
            items = [clean_value(v) for v in value]
            lines.append(f"{key}: [{', '.join(json.dumps(v, ensure_ascii=False) for v in items if v)}]")
        elif isinstance(value, bool):
            lines.append(f"{key}: {'true' if value else 'false'}")
        elif isinstance(value, (int, float)):
            lines.append(f"{key}: {value}")
        else:
            lines.append(f"{key}: {json.dumps(clean_value(value), ensure_ascii=False)}")
    lines.append("---")
    return "\n".join(lines) + "\n\n" + sanitize(body).strip() + "\n"


def write_if_changed(path: pathlib.Path, text: str) -> bool:
    if path.is_file() and path.read_text(encoding="utf-8") == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)
    return True


def load_tool(root: pathlib.Path):
    path = root / "bin" / "cortex"
    if not path.is_file():
        path = TEMPLATE / "bin" / "cortex"
    loader = importlib.machinery.SourceFileLoader("cortex_cli", str(path))
    spec = importlib.util.spec_from_loader("cortex_cli", loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


FM_RE = re.compile(r"\A---\n(.*?)\n---\n?(.*)\Z", re.S)


def read_node(tool, path: pathlib.Path) -> tuple[dict, str] | None:
    m = FM_RE.match(path.read_text(encoding="utf-8"))
    if not m:
        return None
    fm = tool.yaml_parse(m.group(1))
    return (fm, m.group(2)) if isinstance(fm, dict) else None


def origin_nodes(tool, root: pathlib.Path, nexus: str, origin: str) -> dict[str, pathlib.Path]:
    out = {}
    folder = root / "GROUND" / "NEXUS" / nexus
    for path in folder.glob("*.md") if folder.is_dir() else []:
        node = read_node(tool, path)
        if node and str(node[0].get("origin") or "") == origin:
            out[path.stem] = path
    return out


def today() -> str:
    return dt.date.today().isoformat()


# ──────────────────────────────────────────────────────────────────────────────
# команды
# ──────────────────────────────────────────────────────────────────────────────

def cmd_init(root: pathlib.Path, name: str, template: pathlib.Path) -> None:
    if not (root / "GROUND" / "SCHEMA").is_dir():
        if not (template / "GROUND" / "SCHEMA").is_dir():
            sys.exit(f"нет шаблона poh-cortex в {template}")
        root.mkdir(parents=True, exist_ok=True)
        shutil.copytree(template / "GROUND", root / "GROUND", dirs_exist_ok=True)
        shutil.copytree(template / "bin", root / "bin", dirs_exist_ok=True)
        print(f"✓ vault из шаблона: {root}")
    config = root / "GROUND" / "config.yaml"
    text = config.read_text(encoding="utf-8")
    text = re.sub(r'(?m)^company:.*$', f'company: "{name}"', text, count=1)
    write_if_changed(config, text)
    registry = root / "GROUND" / "NEXUS" / "_registry.yaml"
    text = registry.read_text(encoding="utf-8")
    # IT-ландшафт и бизнес-процессы в шаблоне закомментированы — память БФТ без них не память.
    text = re.sub(r"(?m)^  # - (\{slug: (landscape|processes),)", r"  - \1", text)
    for slug_name, line in NEXUSES.items():
        if not re.search(rf"(?m)^  - \{{slug: {re.escape(slug_name)},", text):
            text = text.rstrip("\n") + f"\n  - {line}\n"
    write_if_changed(registry, text)
    for slug_name in ("landscape", "processes", *NEXUSES):
        (root / "GROUND" / "NEXUS" / slug_name).mkdir(parents=True, exist_ok=True)
    tool = load_tool(root)
    cx = tool.Cortex(root)
    missing = [s for s in ("landscape", "processes", *NEXUSES) if s not in cx.nexuses]
    if missing:
        sys.exit(f"реестр Нексусов не принял: {', '.join(missing)}")
    print(f"✓ {name}: Нексусов {len(cx.nexuses)}, узлов {len(cx.nodes)}")


def cmd_glossary(root: pathlib.Path, file: pathlib.Path) -> None:
    tool = load_tool(root)
    data = json.loads(file.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        sys.exit("словарь — объект {термин: {meaning}}")
    origin = "import:glossary"
    old = origin_nodes(tool, root, "glossary", origin)
    seen, changed = set(), 0
    for term, entry in sorted(data.items()):
        entry = entry if isinstance(entry, dict) else {"meaning": entry}
        meaning = clean_value(entry.get("meaning") or "")
        term = clean_value(term)
        if entry.get("deleted") or not term or not meaning:
            continue
        node_id = f"term-{slug(term)}"
        # «ГДС» и «GDS» дают один slug: второй по алфавиту получает номер — детерминированно.
        base, n = node_id, 2
        while node_id in seen:
            node_id, n = f"{base}-{n}", n + 1
        seen.add(node_id)
        fm = {
            "nexus": "glossary", "node_id": node_id, "node_type": "term", "kind": "empirical",
            "owner": "bft-creator", "cp": 4, "change_rate": "low", "sources": ["glossary"],
            "updated": _date_of(entry.get("ts")) or today(), "ripeness": "fresh", "status": "accepted", "origin": origin,
            "title": f"{term} — {meaning[:120]}", "term": term, "meaning": meaning, "tags": [term],
        }
        changed += write_if_changed(root / "GROUND" / "NEXUS" / "glossary" / f"{node_id}.md", dump(fm, f"# {term}\n\n{meaning}"))
    removed = 0
    for node_id, path in old.items():
        if node_id not in seen:
            path.unlink()
            removed += 1
    print(f"✓ словарь: терминов {len(seen)}, изменено {changed}, удалено {removed}")


def _date_of(value) -> str | None:
    if value in (None, ""):
        return None
    try:
        if isinstance(value, (int, float)) or re.fullmatch(r"\d+(\.\d+)?", str(value)):
            seconds = float(value)
            return dt.date.fromtimestamp(seconds / 1000 if seconds > 1e11 else seconds).isoformat()
        return dt.date.fromisoformat(str(value)[:10]).isoformat()
    except (ValueError, OverflowError, OSError):
        return None


def _doc_date(text: str, path: pathlib.Path) -> str:
    m = re.search(r"\b(\d{2})\.(\d{2})\.(20\d{2})\b", text[:3000])
    if m:
        try:
            return dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1))).isoformat()
        except ValueError:
            pass
    m = re.search(r"\b(20\d{2})-(\d{2})-(\d{2})\b", text[:3000])
    if m:
        return m.group(0)
    return dt.date.fromtimestamp(path.stat().st_mtime).isoformat()


def _plain(text: str) -> str:
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"[*_`]+", "", text)
    return re.sub(r"\s+", " ", text).strip()


def _paragraphs(md: str) -> list[str]:
    out = []
    for block in re.split(r"\n\s*\n", md):
        lines = [l for l in block.splitlines() if l.strip() and not l.lstrip().startswith(("#", "|", "```", "<", "---"))]
        text = _plain(" ".join(l.strip().lstrip("-*> ").strip() for l in lines))
        if len(text) >= 40:
            out.append(text)
    return out


def _sections(md: str) -> list[tuple[str, str]]:
    parts = re.split(r"(?m)^(#{1,3} .+)$", md)
    out = [("", parts[0])]
    for i in range(1, len(parts) - 1, 2):
        out.append((_plain(parts[i].lstrip("#")), parts[i + 1]))
    return out


def _row(md: str, key: str) -> str:
    """Значение строки таблицы канона БФТ («| **ПРОБЛЕМА** | … |», «| S (Specific) | … |»)."""
    m = re.search(rf"(?mi)^\|\s*\**{key}\**\s*\|\s*(.+?)\s*\|\s*$", md)
    return _plain(m.group(1)) if m else ""


def bft_summary(md: str) -> str:
    # Канон bft-writer: проблема и цель — таблицами («Проблема которую решаем», SMART).
    what, problem = _row(md, "ЧТО ДЕЛАЕМ"), _row(md, "ПРОБЛЕМА")
    if what or problem:
        return " ".join(filter(None, [what, f"Проблема: {problem}" if problem else ""]))[:500]
    specific = _row(md, r"S \(Specific\)")
    if specific:
        return specific[:500]
    return _paragraph_summary(md)


def _paragraph_summary(md: str) -> str:
    """Суть прошлого БФТ: первый связный абзац раздела «Проблема», затем «Цель», «Контекст/суть»,
    «Шапка»; иначе первый абзац документа. Служебные строки («Версия…», «Статус…») — не суть."""
    sections = _sections(md)
    meta = re.compile(r"(?i)^(версия|статус|метка|основа|автор|источник вводных)\b")
    for pattern in (r"проблем", r"цель", r"контекст|суть", r"шапка"):
        for title, body in sections:
            if re.search(rf"(?i){pattern}", title):
                paras = [p for p in _paragraphs(body) if not meta.match(p)]
                if paras:
                    return paras[0][:500]
    paras = [p for p in _paragraphs(md) if not meta.match(p)]
    return paras[0][:500] if paras else ""


def bft_title(md: str, stem: str) -> str:
    """Заголовок H1 без «[БФТ]»; нет его — начало цели документа; нет и её — имя файла."""
    m = re.search(r"(?m)^# (.+)$", md)
    title = _plain(m.group(1)) if m else ""
    title = re.sub(r"^(?:📋\s*)?\[?БФТ\]?(?:-требования)?[:\s—–-]*", "", title).strip()
    if not title:
        summary = _row(md, "ЧТО ДЕЛАЕМ") or _row(md, r"S \(Specific\)") or bft_summary(md)
        title = re.split(r"(?<=[^\d\s][.;!?])\s", summary, maxsplit=1)[0][:120].rstrip(".;:") if summary else stem
    return f"БФТ: {title}"[:160]


def cmd_bft(root: pathlib.Path, files: list[pathlib.Path]) -> None:
    """Архив только растёт: документ, которого нет в этом вызове, остаётся в памяти."""
    origin = "import:bft"
    changed = 0
    for path in files:
        md = sanitize(path.read_text(encoding="utf-8"))
        name = slug(path.stem)
        node_id = f"bft-{name}"
        heads = [_plain(t) for t, _ in _sections(md) if t][:24]
        summary = bft_summary(md)
        body_text = "\n".join(_paragraphs(md))[:BFT_BODY_LIMIT]
        body = "\n\n".join(filter(None, [
            f"# {bft_title(md, path.stem)}", summary,
            ("Разделы: " + "; ".join(heads)) if heads else "", body_text,
        ]))
        fm = {
            "nexus": "bft-archive", "node_id": node_id, "node_type": "precedent", "kind": "empirical",
            "owner": "bft-creator", "cp": 3, "change_rate": "low", "sources": [f"bft:{name}"],
            "updated": _doc_date(md, path), "ripeness": "fresh", "status": "accepted", "origin": origin,
            "title": bft_title(md, path.stem),
        }
        changed += write_if_changed(root / "GROUND" / "NEXUS" / "bft-archive" / f"{node_id}.md", dump(fm, body))
    print(f"✓ архив БФТ: документов {len(files)}, изменено {changed}")


def cmd_doc(root: pathlib.Path, file: pathlib.Path, node_id: str, nexus: str, node_type: str, title: str | None) -> None:
    md = sanitize(file.read_text(encoding="utf-8"))
    m = re.search(r"(?m)^# (.+)$", md)
    title = title or (_plain(m.group(1)) if m else file.stem)
    body = re.sub(r"(?m)^# .+$", "", md, count=1).strip()
    fm = {
        "nexus": nexus, "node_id": node_id, "node_type": node_type, "kind": "empirical", "owner": "bft-creator",
        "cp": 3, "change_rate": "medium", "sources": [f"doc:{slug(file.stem)}"], "updated": _doc_date(md, file),
        "ripeness": "fresh", "status": "accepted", "origin": f"import:doc:{slug(file.stem)}", "title": title,
    }
    changed = write_if_changed(root / "GROUND" / "NEXUS" / nexus / f"{node_id}.md", dump(fm, f"# {title}\n\n{body}"))
    print(f"✓ документ {file.name} → {nexus}/{node_id}{' (изменён)' if changed else ''}")


def _facts(body: str) -> tuple[str, list[str]]:
    """Тело узла: первый абзац (описание) и маркированные факты."""
    text = re.sub(r"(?m)^# .+$", "", body).strip()
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    lead = next((p for p in paras if not p.lstrip().startswith(("-", "*"))), "")
    facts = [l.strip() for l in text.splitlines() if re.match(r"^\s*[-*] ", l)]
    return lead, facts


def merge_nodes(nodes: list[tuple[dict, str]]) -> tuple[dict, str]:
    nodes = sorted(nodes, key=lambda n: -int(n[0].get("cp") or 0))
    fm = dict(nodes[0][0])
    for key in LISTS:
        merged: list[str] = []
        for node_fm, _ in nodes:
            value = node_fm.get(key) or []
            for item in value if isinstance(value, list) else [value]:
                if item and str(item) not in merged:
                    merged.append(str(item))
        if merged:
            fm[key] = merged
    # Поиск Кортекса индексирует заголовок, теги и тело — имена из aliases ищутся через теги.
    fm["tags"] = list(dict.fromkeys([*(fm.get("tags") or []), *(fm.get("aliases") or [])]))
    cp = max(int(n[0].get("cp") or 3) for n in nodes)
    if len(set(fm.get("sources") or [])) > 1:
        cp = min(5, cp + 1)
    fm["cp"] = cp
    fm["updated"] = max(str(n[0].get("updated") or "") for n in nodes) or today()
    lead, facts = _facts(nodes[0][1])
    seen = {re.sub(r"\W+", "", f.lower()) for f in facts}
    for _, body in nodes[1:]:
        other_lead, other_facts = _facts(body)
        lead = lead or other_lead
        for fact in other_facts:
            key = re.sub(r"\W+", "", fact.lower())
            if key not in seen:
                seen.add(key)
                facts.append(fact)
    body = "\n\n".join(filter(None, [f"# {fm['title']}", lead, "\n".join(facts)]))
    return fm, body


def cmd_curated(root: pathlib.Path, dirs: list[pathlib.Path]) -> None:
    tool = load_tool(root)
    groups: dict[str, list[tuple[dict, str]]] = {}
    skipped = []
    for folder in dirs:
        for path in sorted(folder.rglob("*.md")):
            if path.name.startswith("_"):
                continue
            node = read_node(tool, path)
            if not node:
                skipped.append(f"{path}: нет шапки")
                continue
            fm, body = node
            missing = [k for k in REQUIRED if not fm.get(k)]
            if missing:
                skipped.append(f"{path.name}: нет {', '.join(missing)}")
                continue
            if fm["nexus"] not in CURATED_NEXUSES:
                skipped.append(f"{path.name}: Нексус {fm['nexus']} не для разбора")
                continue
            groups.setdefault(str(fm["node_id"]), []).append((fm, body))
    imported = {nid for nid in origin_nodes(tool, root, "glossary", "import:glossary")}
    written = merged = 0
    for node_id, nodes in sorted(groups.items()):
        fm, body = merge_nodes(nodes)
        if node_id in imported:
            skipped.append(f"{node_id}: термин уже есть в словаре владельца")
            continue
        fm["origin"] = "curated"
        fm.setdefault("status", "accepted")
        # Объявленная свежесть — для гейта; Кортекс всё равно считает её от updated и TTL Нексуса.
        fm["ripeness"] = "fresh"
        order = ["nexus", "node_id", "node_type", "kind", "owner", "cp", "change_rate", "sources", "updated", "ripeness", "status",
                 "origin", "title", "aliases", "tags", "where_to_check", "environments", "full_name", "role_title",
                 "influence_zones", "contact_for"]
        ordered = {k: fm[k] for k in order if k in fm}
        ordered.update({k: v for k, v in fm.items() if k not in ordered})
        written += write_if_changed(root / "GROUND" / "NEXUS" / str(fm["nexus"]) / f"{node_id}.md", dump(ordered, body))
        merged += len(nodes) > 1
    print(f"✓ разбор: узлов {len(groups)}, слито дублей {merged}, изменено {written}")
    for line in skipped:
        print(f"  пропущено: {line}")


def cmd_check(root: pathlib.Path) -> int:
    tool = load_tool(root)
    cx = tool.Cortex(root)
    issues = tool.run_gate(cx)
    errors = [i for i in issues if getattr(i, "sev", getattr(i, "severity", "")) == "ERROR"]
    counts: dict[str, int] = {}
    for n in cx.nodes:
        if n.layer == "curated" and n["nexus"]:
            counts[str(n["nexus"])] = counts.get(str(n["nexus"]), 0) + 1
    print(f"Память {cx.config.get('company')}: узлов {len(cx.nodes)}; " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))
    for issue in errors[:20]:
        print(f"  ✗ {issue.where}: {issue.msg}")
    print(f"гейт: ошибок {len(errors)}, всего замечаний {len(issues)}")
    return 1 if errors else 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("init"); a.add_argument("root"); a.add_argument("--name", default=NAME); a.add_argument("--template", default=str(TEMPLATE))
    a = sub.add_parser("glossary"); a.add_argument("root"); a.add_argument("file")
    a = sub.add_parser("doc"); a.add_argument("root"); a.add_argument("file"); a.add_argument("--id", required=True)
    a.add_argument("--nexus", default="landscape"); a.add_argument("--type", default="system-component"); a.add_argument("--title")
    a = sub.add_parser("bft"); a.add_argument("root"); a.add_argument("files", nargs="+")
    a = sub.add_parser("curated"); a.add_argument("root"); a.add_argument("dirs", nargs="+")
    a = sub.add_parser("check"); a.add_argument("root")
    args = p.parse_args(argv)
    root = pathlib.Path(args.root)
    if args.cmd == "init":
        cmd_init(root, args.name, pathlib.Path(args.template))
    elif args.cmd == "glossary":
        cmd_glossary(root, pathlib.Path(args.file))
    elif args.cmd == "doc":
        cmd_doc(root, pathlib.Path(args.file), args.id, args.nexus, args.type, args.title)
    elif args.cmd == "bft":
        cmd_bft(root, [pathlib.Path(f) for f in args.files])
    elif args.cmd == "curated":
        cmd_curated(root, [pathlib.Path(d) for d in args.dirs])
    elif args.cmd == "check":
        return cmd_check(root)
    return 0


if __name__ == "__main__":
    sys.exit(main())
