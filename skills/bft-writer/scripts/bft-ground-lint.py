#!/usr/bin/env python3
"""bft-ground-lint — сверка документа с источником: чего нет во входе.

Третий машинный гейт рядом с `bft-lint.py` (структура) и `bft-style-lint.py`
(лексика). Отвечает на вопрос, который самоотчёт модели закрыть не может:
не появилось ли в документе сущностей, которых во входном тексте нет.

Зачем нужен. Живой прогон `/bft-fast` на Haiku принёс в документ про потоки
Kafka сущности «MRS» и «FAQ для категорий» из соседней golden-фикстуры про
другой эпик. Периметр внешних источников при этом соблюдался, а на прямой
вопрос «выдумывал ли факты» прогон ответил «нет» — и был искренен. Утечка
пришла из примеров в самих инструкциях (ЗМ-024).

Что проверяет. Два класса.

`GR001` — редкие содержательные токены документа: латиница, аббревиатуры
капслоком, слова с заглавной буквы вне начала предложения — которых нет в
источнике.

`GR002` — величины с единицей измерения (24 часа, 200 мс, 350 RPS, 5 попыток),
числа которых в источнике нет. Ловит фабрикацию точности (ЗМ-029): под давлением
гейта измеримости мягкое «сутки подойдут, не принципиально» превращается в
«SLA 24 часа». Цифра выглядит согласованной, документ внутренне непротиворечив,
и самопроверка модели такую находку не видит — числа в источнике просто не было.
Обе находки — сигнал, а не приговор. Это сигнал, а не приговор: часть находок легитимна (термины
шаблона, названия разделов). Поэтому уровень по умолчанию WARN, а `--strict`
превращает находки в ERROR для использования гейтом.

Использование:
    python3 scripts/bft-ground-lint.py <документ.md> --source <summary.md>
    python3 scripts/bft-ground-lint.py <документ.md> --source <a.md> --source <b.csv> --strict

Коды выхода: 0 — находок нет (или они только WARN без `--strict`);
1 — есть ERROR (только со `--strict`); 2 — файл не прочитан.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path

# Служебная лексика шаблона: эти слова живут в форме документа, а не в источнике.
TEMPLATE_VOCABULARY = {
    "БФТ", "БТ", "ПТ", "ИТ", "ФТ", "НФТ", "SMART", "Specific", "Measurable",
    "Achievable", "Relevant", "Time", "bound", "Time-bound", "ASIS", "TOBE", "UJM", "PO", "СА",
    "УТОЧНИТЬ", "СОЗДАТЬ", "Цель", "How", "to", "demo", "Confluence", "Jira",
    "JIRA", "Kafka", "PDF", "MCP", "URL", "TTL", "RPS", "SLA", "P95", "TBD",
    "Шапка", "Проблема", "Изменение", "План", "Бизнес", "Требования", "Ценность",
    "Пользовательские", "Интерфейсы", "Функциональные", "Нефункциональные",
    "Зависимости", "Риски", "Якоря", "Общая", "Ограничения", "Документация",
    "Статус", "Название", "Ответственный", "Задача", "Epic", "Системные",
    "Поле", "Значение", "Идентификатор", "Наименование", "Приоритет", "Story",
    "Комментарий", "Актор", "Описание", "Срез", "Содержание", "Полный",
    "Собрана", "Черновик", "АНАЛИЗ", "Высокий", "Средний", "Низкий", "Когда",
    "Хочу", "Чтобы", "Претензий", "Claude", "Code", "BFT", "HEAD", "END",
    "MTS", "bft-fast", "bft-deep", "bft-writer", "details", "summary", "Довести",
    "Макеты", "Митигация", "Вероятность", "Влияние", "Риск", "Команда", "Тип",
    "Факт", "Источник", "Ранг", "Связанные", "Параметры", "Требование", "Точка",
    "Было", "Стало", "Информация", "Конспект", "Ответ", "Дата", "Роль", "ФИО",
    "КОГО", "ДЕЛАЕМ", "ПРОБЛЕМА", "As-Is", "To-Be", "happy", "path", "alt",
    "Расширенный", "Сценарий", "Акторы", "Продолжить", "Вопрос", "Влияние",
    "plantuml", "autonumber", "actor", "participant", "activate", "deactivate",
    "startuml", "enduml", "else", "end", "Summary", "ADR", "R1", "R2", "R3",
}

# Пути и имена файлов: служебные ссылки навыка, не сущности предметной области.
PATH_RE = re.compile(r"[/\\]|\.(md|csv|py|json|ya?ml)$", re.I)

# Токены: латинские слова, аббревиатуры, слова с заглавной буквы, числа с единицами.
TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9_.\-]{2,}|[А-ЯЁ][А-Яа-яёЁ\-]{2,}|\b\d+\s?%")

# Величина с единицей измерения: то, что читается как согласованный порог.
# Идентификаторы (ФТ-8), даты и pageId единицы не несут и сюда не попадают.
QUANTITY_RE = re.compile(
    r"\b(\d+(?:[.,]\d+)?)\s*"
    r"(%|мс|секунд\w*|сек\b|минут\w*|мин\b|часа?\b|часов\b|суток\b|сутки\b|"
    r"дней\b|дня\b|день\b|недел\w*|месяц\w*|RPS|rps|шт\b|попыт\w*|раз\b|раза\b|"
    r"[КМГ]?[Бб]айт\w*|[КМГ]б\b|символ\w*|запис\w*|элемент\w*|строк\w*|"
    r"пользовател\w*|польз\b)",
    re.IGNORECASE)

# Порог без единицы: «не более 4 тегов», «до 3 попыток». Ограничитель делает число
# таким же обязывающим, как единица измерения.
THRESHOLD_RE = re.compile(
    r"(?:не более|не менее|не превыш\w+|более|менее|до|минимум|максимум|максимальн\w+|"
    r"минимальн\w+|в течение|за)\s+(\d+(?:[.,]\d+)?)(?=\s+[А-Яа-яёЁA-Za-z])",
    re.IGNORECASE)

# Числа источника: величина считается заякоренной, если её число там встречается.
NUMBER_RE = re.compile(r"\d+(?:[.,]\d+)?")

# Цель markdown-ссылки: pageId и номера задач в URL — не пороги требований.
LINK_TARGET_RE = re.compile(r"\]\([^)]*\)")


@dataclass
class Finding:
    line: int
    level: str
    code: str
    token: str
    excerpt: str


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower())


def skip_zones(lines: list[str]) -> set[int]:
    """Строки вне проверки: frontmatter, fenced-блоки, HTML-комментарии.

    Промт открытого поля лежит в fenced-блоке и намеренно несёт служебную
    лексику навыка — сверять его с источником бессмысленно.
    """
    skip: set[int] = set()
    if lines and lines[0].strip() == "---":
        skip.add(1)
        for i in range(1, len(lines)):
            skip.add(i + 1)
            if lines[i].strip() == "---":
                break
    in_fence = in_comment = False
    for idx, raw in enumerate(lines, start=1):
        if raw.lstrip().startswith("```"):
            in_fence = not in_fence
            skip.add(idx)
            continue
        if in_fence:
            skip.add(idx)
            continue
        if in_comment:
            skip.add(idx)
            if "-->" in raw:
                in_comment = False
            continue
        if "<!--" in raw:
            skip.add(idx)
            if "-->" not in raw:
                in_comment = True
    return skip


def code_spans(line: str) -> list[tuple[int, int]]:
    """Диапазоны inline-кода. Внутри бэктиков живут пути и имена файлов —
    служебные ссылки навыка, а не сущности предметной области."""
    return [(m.start(), m.end()) for m in re.finditer(r"`[^`]+`", line)]


def starts_sentence(line: str, pos: int) -> bool:
    """Токен открывает предложение: начало строки, пункт списка, номер, после точки."""
    prefix = line[:pos].rstrip()
    if not prefix:
        return True
    return bool(re.search(r"(^|[.!?:;|])\s*$|^\s*(?:[-*>|]|\d+[.)])\s*$", prefix))


def grounded(token: str, source_text: str) -> bool:
    """Токен есть в источнике — точно либо по корню (5 первых букв)."""
    low = token.lower()
    if low in source_text:
        return True
    stem = low[:5]
    return len(stem) >= 4 and stem in source_text


def source_numbers(source_text: str) -> set[str]:
    """Числа источника в нормализованном виде (запятая = точка, без хвостовых нулей)."""
    return {canonical_number(m.group()) for m in NUMBER_RE.finditer(source_text)}


def canonical_number(raw: str) -> str:
    value = raw.replace(",", ".")
    if "." in value:
        value = value.rstrip("0").rstrip(".")
    return value or "0"


def quantity_findings(lines: list[str], skip: set[int], numbers: set[str], level: str) -> list[Finding]:
    """Величины документа, числа которых нет в источнике (ЗМ-029)."""
    out: list[Finding] = []
    seen: set[str] = set()
    for idx, raw in enumerate(lines, start=1):
        if idx in skip or raw.lstrip().startswith("#"):
            continue
        spans = code_spans(raw) + [(m.start(), m.end()) for m in LINK_TARGET_RE.finditer(raw)]
        # Величина с единицей информативнее порога без неё: «24 часа» вместо «за 24».
        # Одно и то же число в строке ловят оба выражения — сообщаем о нём один раз.
        reported: set[str] = set()
        for match in list(QUANTITY_RE.finditer(raw)) + list(THRESHOLD_RE.finditer(raw)):
            if any(s <= match.start() < e for s, e in spans):
                continue
            number = canonical_number(match.group(1))
            if number in numbers or number in reported:
                continue
            quantity = match.group().strip()
            if quantity.lower() in seen:
                continue
            reported.add(number)
            seen.add(quantity.lower())
            excerpt = raw.strip()
            if len(excerpt) > 90:
                excerpt = excerpt[:87] + "..."
            out.append(Finding(idx, level, "GR002", quantity, excerpt))
    return out


def lint(doc_path: Path, sources: list[Path], strict: bool) -> list[Finding]:
    source_text = normalize("\n".join(p.read_text(encoding="utf-8-sig") for p in sources))
    lines = doc_path.read_text(encoding="utf-8").split("\n")
    skip = skip_zones(lines)
    level = "ERROR" if strict else "WARN"

    seen: set[str] = set()
    out: list[Finding] = []
    for idx, raw in enumerate(lines, start=1):
        if idx in skip or raw.lstrip().startswith("#"):
            continue
        spans = code_spans(raw)
        for match in TOKEN_RE.finditer(raw):
            if any(s <= match.start() < e for s, e in spans):
                continue
            token = match.group().strip().strip("-._")
            if PATH_RE.search(token):
                continue
            if token in TEMPLATE_VOCABULARY or token.lower() in seen:
                continue
            if len(token) < 3:
                continue
            if starts_sentence(raw, match.start()) and not token.isupper():
                # Заглавная буква здесь грамматическая, а не имя собственное.
                continue
            if grounded(token, source_text):
                continue
            seen.add(token.lower())
            excerpt = raw.strip()
            if len(excerpt) > 90:
                excerpt = excerpt[:87] + "..."
            out.append(Finding(idx, level, "GR001", token, excerpt))
    out += quantity_findings(lines, skip, source_numbers(source_text), level)
    return sorted(out, key=lambda f: (f.line, f.code))


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Сверка документа БФТ с источником (ЗМ-024, ЗМ-029)")
    parser.add_argument("document", type=Path)
    parser.add_argument("--source", type=Path, action="append", required=True,
                        help="входной текст прогона (Summary, транскрипт, csv); можно указать несколько раз")
    parser.add_argument("--strict", action="store_true", help="находки как ERROR, ненулевой код выхода")
    parser.add_argument("--format", choices=["text", "json"], default="text")
    args = parser.parse_args(argv)

    for path in [args.document, *args.source]:
        if not path.is_file():
            print(f"{path}: ERROR IO001 файл не найден", file=sys.stderr)
            return 2

    findings = lint(args.document, args.source, args.strict)
    if args.format == "json":
        print(json.dumps([asdict(f) for f in findings], ensure_ascii=False, indent=2))
    else:
        for f in findings:
            print(f'{args.document}:{f.line}: {f.level} {f.code} «{f.token}» — нет в источнике: «{f.excerpt}»')
        if not findings:
            print(f"{args.document}: OK — сущностей вне источника не найдено")
        else:
            print(f"\nНайдено {len(findings)}. `GR001` — либо факт из чужого примера (ЗМ-024), "
                  f"либо термин, который стоит проверить глазами. `GR002` — величина, числа которой "
                  f"в источнике нет: либо точность дописана за источник (ЗМ-029, гейт 5) и её надо "
                  f"вернуть в мягкую формулировку или `[УТОЧНИТЬ]`, либо число получено пересчётом "
                  f"единиц и его стоит записать так же, как сказал источник.")
    return 1 if (args.strict and findings) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
