#!/usr/bin/env python3
"""Тесты памяти bft-creator (ADR-0016): импортёр и разделы /brief.

  CORTEX_TEMPLATE=<клон poh-cortex> python3 -m unittest harness/cortex/test_memory.py
В образе Кортекса шаблон уже лежит в /opt/poh-cortex. Без шаблона тесты vault
пропускаются, фильтр секретов проверяется всегда.
"""
import importlib
import json
import os
import pathlib
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import bft_memory  # noqa: E402

TEMPLATE = pathlib.Path(os.environ.get("CORTEX_TEMPLATE", "/opt/poh-cortex"))
HAS_TEMPLATE = (TEMPLATE / "GROUND" / "SCHEMA").is_dir()

NODE = """---
nexus: "landscape"
node_id: "sys-kassa"
node_type: "system-component"
kind: "empirical"
owner: "GDS"
cp: 3
change_rate: "medium"
sources: ["bft:{src}"]
updated: "{date}"
status: "accepted"
title: "КАССА — главная билетная платформа"
aliases: [{aliases}]
---

# КАССА — главная билетная платформа

Билетная платформа Fitly, на ней продаются билеты клубов.

- {fact} (bft:{src}).
"""


class SanitizeTest(unittest.TestCase):
    def test_secrets_and_contacts_are_cut(self):
        text = "jira = 10.0.0.1:8080\nпишите a.b@example.org или +7 (912) 345-67-89\nпароль: qwerty\nключ abcdefghijklmnopqrstuvwxyz0123456789ABCD\nКАССА"
        out = bft_memory.sanitize(text)
        for leak in ("10.0.0", "@example.org", "345-67", "qwerty", "abcdefghijklmnop"):
            self.assertNotIn(leak, out)
        self.assertIn("КАССА", out)
        self.assertIn("proc-podklyuchenie-shlyuzovogo-organizatora", bft_memory.sanitize("proc-podklyuchenie-shlyuzovogo-organizatora"))
        self.assertNotIn("ghp_", bft_memory.sanitize("ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7"))

    def test_slug(self):
        self.assertEqual(bft_memory.slug("Щёлково ЖД-вокзал"), "schelkovo-zhd-vokzal")


@unittest.skipUnless(HAS_TEMPLATE, "нет шаблона poh-cortex (CORTEX_TEMPLATE)")
class VaultTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name) / "memory"
        bft_memory.cmd_init(self.root, "bft-creator", TEMPLATE)

    def tearDown(self):
        self.tmp.cleanup()

    def test_glossary_idempotent_collisions_and_removal(self):
        src = pathlib.Path(self.tmp.name) / "g.json"
        src.write_text(json.dumps({"ГДС": {"meaning": "команда интеграций"}, "GDS": {"meaning": "команда GDS"},
                                   "ПК": {"meaning": "клиент, витрина ПК.Афиша"}, "OLD": {"meaning": "x", "deleted": True}},
                                  ensure_ascii=False), encoding="utf-8")
        bft_memory.cmd_glossary(self.root, src)
        folder = self.root / "GROUND" / "NEXUS" / "glossary"
        self.assertEqual(sorted(p.stem for p in folder.glob("*.md")), ["term-gds", "term-gds-2", "term-pk"])
        stamp = {p.name: p.stat().st_mtime_ns for p in folder.glob("*.md")}
        bft_memory.cmd_glossary(self.root, src)
        self.assertEqual(stamp, {p.name: p.stat().st_mtime_ns for p in folder.glob("*.md")}, "повтор не переписывает файлы")
        src.write_text(json.dumps({"ПК": {"meaning": "клиент"}}, ensure_ascii=False), encoding="utf-8")
        bft_memory.cmd_glossary(self.root, src)
        self.assertEqual(sorted(p.stem for p in folder.glob("*.md")), ["term-pk"])

    def test_curated_merge_and_gate(self):
        a = pathlib.Path(self.tmp.name) / "a"
        b = pathlib.Path(self.tmp.name) / "b"
        a.mkdir(); b.mkdir()
        (a / "sys-kassa.md").write_text(NODE.format(src="gid", date="2026-10-01", aliases='"Fitly"', fact="Продажи клубов"), encoding="utf-8")
        (b / "sys-kassa.md").write_text(NODE.format(src="bi", date="2026-10-09", aliases='"ККМ"', fact="Договоры с организаторами"), encoding="utf-8")
        bft_memory.cmd_curated(self.root, [a, b])
        tool = bft_memory.load_tool(self.root)
        fm, body = bft_memory.read_node(tool, self.root / "GROUND" / "NEXUS" / "landscape" / "sys-kassa.md")
        self.assertEqual(fm["sources"], ["bft:gid", "bft:bi"])
        self.assertEqual(fm["cp"], 4, "подтверждено двумя документами")
        self.assertEqual(fm["updated"], "2026-10-09")
        self.assertIn("ККМ", fm["tags"], "aliases ищутся через теги")
        self.assertIn("Продажи клубов", body)
        self.assertIn("Договоры с организаторами", body)
        self.assertEqual(bft_memory.cmd_check(self.root), 0)

    def test_brief_sections(self):
        g = pathlib.Path(self.tmp.name) / "g.json"
        g.write_text(json.dumps({"ПК": {"meaning": "клиент, витрина ПК.Афиша"}, "КАССА": {"meaning": "билетная платформа"}},
                                ensure_ascii=False), encoding="utf-8")
        bft_memory.cmd_glossary(self.root, g)
        doc = pathlib.Path(self.tmp.name) / "bft-vk.md"
        doc.write_text("# [БФТ] Модерация контента для витрины ПК\n\n## Цель\n\nОписания мероприятий попадают на витрину ПК без проверки, нужна премодерация в КАССА.\n",
                       encoding="utf-8")
        bft_memory.cmd_bft(self.root, [doc])
        os.environ["CORTEX_VAULT_ROOT"] = str(self.root)
        server = importlib.reload(importlib.import_module("server"))
        brief = server.brief("Нужна премодерация описаний для ПК: сейчас всё уходит без проверки")
        self.assertEqual(brief["vault"]["name"], "bft-creator")
        self.assertEqual([t["term"] for t in brief["glossary"]], ["ПК"], "термин — целым словом, КАССА в тексте нет")
        self.assertEqual([p["node_id"] for p in brief["precedents"]], ["bft-bft-vk"])
        self.assertIn("премодерация", brief["precedents"][0]["summary"])
        self.assertEqual(brief["processes"], [], "оглавления и методология шаблона — не процессы")
        self.assertEqual(server.brief("вкусный кофе")["glossary"], [], "«вк» внутри слова — не термин ПК")


if __name__ == "__main__":
    unittest.main()
