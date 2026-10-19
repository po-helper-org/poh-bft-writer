#!/usr/bin/env python3
"""Backlog.md этого проекта — встроенный CLI, только python3: ./backlog.py task list --plain (Windows: python backlog.py …)"""
import os, runpy, sys
here = os.path.dirname(os.path.abspath(__file__))
os.chdir(here)
sys.argv[0] = "backlog"
sys.path.insert(0, os.path.join(here, ".blueprint", "scripts"))
runpy.run_path(os.path.join(here, ".blueprint", "scripts", "backlog_cli.py"), run_name="__main__")
