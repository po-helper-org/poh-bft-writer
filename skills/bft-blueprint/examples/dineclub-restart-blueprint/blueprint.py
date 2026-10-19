#!/usr/bin/env python3
"""Карта этого проекта: ./blueprint.py lint | build | check   (build пишет страницу и архив в папку проекта)"""
import os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
scripts = os.path.join(here, ".blueprint", "scripts")
cmd, rest = (sys.argv[1] if len(sys.argv) > 1 else "help"), sys.argv[2:]
if cmd == "lint":
    run = ["bft-backlog-lint.py", here]
elif cmd == "build":
    run = ["bft-backlog-build.py", here, "--out-dir", here]
elif cmd == "check":
    run = ["bft-backlog-build.py", here, "--check"]
else:
    print("./blueprint.py lint   — проверить карту (коды BL, SN; правила — .blueprint/rules/backlog_rules.md)")
    print("./blueprint.py build  — схемы BPMN из «Процесса», страница <epic>-map.html и архив <epic>-blueprint.zip")
    print("./blueprint.py check  — проверка без записи: схемы и скрипты проекта актуальны")
    print("доп. ключи: --source БФТ.md — сверка с БФТ, --strict — предупреждения тоже ошибки")
    sys.exit(0 if cmd in ("help", "-h", "--help") else 2)
sys.exit(subprocess.call([sys.executable, os.path.join(scripts, run[0]), *run[1:], *rest]))
