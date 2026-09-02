#!/usr/bin/env python3
"""Пре-флайт чек-лист перед /bft-deliver (ЗМ-009 / ЗМ-015).

Считает в теле БФТ-документа то, что при публикации в Confluence должно
стать макросами/вложениями, а не остаться как есть: голые markdown-ссылки
на Jira/Confluence и сырые ```plantuml``` блоки. Не изменяет файл — только
репортит, чтобы это было видно в сухом прогоне `/bft-deliver`, а не
терялось при спешке.

Использование:
    python3 bft-deliver-check.py <путь-к-epic.md> [--json]
"""
import argparse
import json
import re
import sys
from pathlib import Path

JIRA_LINK_RE = re.compile(r"\[([^\]]*)\]\((https?://jira\.mts\.ru/browse/([A-Z][A-Z0-9_]+-\d+))\)")
CONFLUENCE_LINK_RE = re.compile(
    r"\[([^\]]*)\]\((https?://confluence\.mts\.ru/pages/viewpage\.action\?pageId=(\d+))\)"
)
BARE_PAGEID_RE = re.compile(r"(?<!\()\bpageId\s+(\d+)\b")
PLANTUML_RE = re.compile(r"```plantuml\b.*?```", re.S)


def check(text: str) -> dict:
    jira_links = [{"text": m.group(1), "key": m.group(3), "url": m.group(2)} for m in JIRA_LINK_RE.finditer(text)]
    confluence_links = [
        {"text": m.group(1), "pageId": m.group(3), "url": m.group(2)} for m in CONFLUENCE_LINK_RE.finditer(text)
    ]
    bare_page_ids = sorted(set(BARE_PAGEID_RE.findall(text)))
    plantuml_blocks = len(PLANTUML_RE.findall(text))
    return {
        "jira_links": jira_links,
        "confluence_links": confluence_links,
        "bare_confluence_pageid_mentions": bare_page_ids,
        "plantuml_blocks": plantuml_blocks,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("md_path")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    text = Path(args.md_path).read_text(encoding="utf-8")
    result = check(text)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    print(f"── ПРЕ-ФЛАЙТ /bft-deliver: {args.md_path} ──")
    print(f"Jira-ссылок (markdown) — не сконвертированы в макрос: {len(result['jira_links'])}")
    for link in result["jira_links"]:
        print(f"  · {link['key']} — «{link['text']}»")
    print(f"Confluence-ссылок (markdown) — не сконвертированы в макрос: {len(result['confluence_links'])}")
    for link in result["confluence_links"]:
        print(f"  · pageId {link['pageId']} — «{link['text']}»")
    if result["bare_confluence_pageid_mentions"]:
        print(f"Голые упоминания «pageId N» (не markdown-ссылка, тоже стоит связать): {', '.join(result['bare_confluence_pageid_mentions'])}")
    print(f"Блоков ```plantuml``` — не отрендерены в PNG-вложение: {result['plantuml_blocks']}")

    total = len(result["jira_links"]) + len(result["confluence_links"]) + result["plantuml_blocks"]
    if total == 0:
        print("OK — нечего конвертировать, тело готово к публикации как есть.")
        sys.exit(0)
    print(f"Итого {total} мест требуют конвертации перед публикацией (ЗМ-009/ЗМ-015) — см. bft-confluence-macros.py и bft-render-plantuml.py.")
    sys.exit(1)


if __name__ == "__main__":
    main()
