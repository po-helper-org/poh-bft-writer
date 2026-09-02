#!/usr/bin/env python3
"""Конвертация Jira/Confluence markdown-ссылок в Confluence-макросы (ЗМ-009).

Публикуемая страница БФТ должна отдавать каждое упоминание Jira/Confluence
макросом (превью + быстрый доступ), а не голой markdown-ссылкой. Только
существующие страницы/эпики — несуществующее сюда не подставлять
(это проверяется отдельно, на Этапе 1.5 `/bft-deliver`, до вызова скрипта).

Использование:
    python3 bft-confluence-macros.py <путь-к-epic.md> \
        --confluence-map confluence-map.json [--format storage|wiki] [-o output.txt]

`confluence-map.json` — `{"<pageId>": {"title": "...", "space": "SPACE"}}`,
собирается вызывающим (агентом) через `confluence_get_page` для каждого
pageId, встречающегося в документе — сам скрипт Confluence не читает.
Jira-ссылкам сопоставление не нужно: ключ уже есть в URL.

Без `--confluence-map` Confluence-ссылки не трогаются (остаются markdown) —
явно предупреждается в stderr, чтобы это не терялось молча.
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


def jira_macro(key: str, fmt: str) -> str:
    if fmt == "wiki":
        return f"{{jira:key={key}}}"
    return f'<ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">{key}</ac:parameter></ac:structured-macro>'


def confluence_macro(page_id: str, link_text: str, page_info: dict, fmt: str) -> str:
    title = page_info.get("title")
    space = page_info.get("space")
    if not title:
        # No lookup available — leave a plain link rather than emit a broken macro.
        return f'<a href="https://confluence.mts.ru/pages/viewpage.action?pageId={page_id}">{link_text}</a>'
    if fmt == "wiki":
        if space:
            return f"[{link_text}>{space}:{title}]"
        return f"[{link_text}>{title}]"
    space_attr = f' ri:space-key="{space}"' if space else ""
    return f'<ac:link><ri:page ri:content-title="{title}"{space_attr}/><ac:plain-text-link-body><![CDATA[{link_text}]]></ac:plain-text-link-body></ac:link>'


def convert(text: str, confluence_map: dict, fmt: str) -> tuple[str, list[str]]:
    warnings = []

    def jira_repl(m):
        return jira_macro(m.group(3), fmt)

    text = JIRA_LINK_RE.sub(jira_repl, text)

    def confluence_repl(m):
        link_text, page_id = m.group(1), m.group(3)
        info = confluence_map.get(page_id)
        if not info:
            warnings.append(f"pageId {page_id} нет в confluence-map — оставлена markdown-ссылка (или plain <a>, не макрос)")
            return confluence_macro(page_id, link_text, {}, fmt)
        return confluence_macro(page_id, link_text, info, fmt)

    text = CONFLUENCE_LINK_RE.sub(confluence_repl, text)
    return text, warnings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("md_path")
    ap.add_argument("--confluence-map", help="JSON-файл {pageId: {title, space}}")
    ap.add_argument("--format", choices=["storage", "wiki"], default="storage")
    ap.add_argument("-o", "--output")
    args = ap.parse_args()

    text = Path(args.md_path).read_text(encoding="utf-8")

    confluence_map = {}
    if args.confluence_map:
        confluence_map = json.loads(Path(args.confluence_map).read_text(encoding="utf-8"))
    elif CONFLUENCE_LINK_RE.search(text):
        print("[УТОЧНИТЬ] в документе есть Confluence-ссылки, но --confluence-map не передан — они не будут превращены в макросы", file=sys.stderr)

    converted, warnings = convert(text, confluence_map, args.format)
    for w in warnings:
        print(f"[УТОЧНИТЬ] {w}", file=sys.stderr)

    if args.output:
        Path(args.output).write_text(converted, encoding="utf-8")
        print(f"OK — записано {args.output}")
    else:
        print(converted)


if __name__ == "__main__":
    main()
