#!/usr/bin/env python3
"""Резолв ссылок на ресурсы навыка после установки (дефект «битые пути», issue #2).

install.sh раскладывает команды и навыки сиблингами под один agent-root
(.claude/commands + .claude/skills, .agents/prompts + .agents/skills, …).
Корня skills/ в воркспейсе после установки нет, поэтому корневая ссылка
`skills/bft-writer/resources/x.md` из команды не резолвится ни в одной раскладке.

Скрипт разворачивает виртуальную установку каждой раскладки и проверяет три формы
(`SKILL.md` §«Пути к ресурсам после установки»):
  ../skills/{навык}/…      — doc-ссылка из файла команды, относительная от файла
  ../{навык}/…             — doc-ссылка на соседний навык, относительная от файла
  <skills_path>/{навык}/…  — запуск скрипта в шелле, от корня воркспейса

Запуск из корня репозитория:
    python3 skills/bft-writer/scripts/bft-paths-lint.py
"""
import pathlib
import re
import sys

# (agent-root, каталог команд) — раскладки install.sh
LAYOUTS = [
    (".claude", "commands"),
    (".agents", "prompts"),
    (".clinerules", "workflows"),
    (".agents", "commands"),
]

# Ссылка на ресурс навыка в любой из трёх форм.
REF = re.compile(r"(?:\.\./)*(?:<skills_path>|skills)/bft-[A-Za-z0-9_./-]+")
# Хвостовая пунктуация markdown-прозы, не входящая в путь.
TRAILING = ".,);:`»"


def refs(line: str):
    for raw in REF.findall(line):
        ref = raw.rstrip(TRAILING)
        # `{навык}/{файл}` — шаблон формы в документации, не конкретная ссылка
        if "{" in ref or "…" in ref:
            continue
        yield ref


def resolve(ref: str, source: pathlib.Path, workspace: pathlib.Path, skills_root: pathlib.Path):
    """Путь, по которому ссылку будет искать агент, либо None если форма не проверяется."""
    if ref.startswith("<skills_path>/"):
        # шелл-вызов: cwd = корень воркспейса, <skills_path> разрешён в папку установки
        return workspace / skills_root / ref[len("<skills_path>/"):]
    if ref.startswith("../"):
        # doc-ссылка: относительно файла, в котором написана
        return (source.parent / ref).resolve()
    # корневая `skills/…` — ровно та форма, которая после установки не резолвится
    return None


def is_instruction(source: pathlib.Path) -> bool:
    """Файл-инструкция (её ссылки резолвит агент) против артефакта.

    `examples/` и `scripts/fixtures/` — эталоны сгенерированных документов: пути в них
    принадлежат тому прогону (входной Summary, путь установки у PO), а не навыку.
    """
    parts = source.parts
    return "examples" not in parts and "fixtures" not in parts


def check_layout(repo: pathlib.Path, root: str, cmd_dir: str):
    """Виртуальная установка: где какой файл окажется, без копирования на диск."""
    workspace = repo / "__ws__"
    placed = {}  # путь после установки -> исходник в репозитории
    for f in (repo / "commands").rglob("*"):
        placed[workspace / root / cmd_dir / f.relative_to(repo / "commands")] = f
    for f in (repo / "skills").rglob("*"):
        placed[workspace / root / "skills" / f.relative_to(repo / "skills")] = f
    existing = set(placed)
    existing.update(p for installed in placed for p in installed.parents)

    bad, total = [], 0
    for installed, source in sorted(placed.items()):
        if not source.is_file() or source.suffix != ".md" or not is_instruction(source):
            continue
        for i, line in enumerate(source.read_text(encoding="utf-8").splitlines(), 1):
            for ref in refs(line):
                target = resolve(ref, installed, workspace, pathlib.Path(root) / "skills")
                if target is None:
                    bad.append((source.relative_to(repo), i, ref, "корневая ссылка `skills/…` — после установки не резолвится"))
                    continue
                total += 1
                if target not in existing:
                    bad.append((source.relative_to(repo), i, ref, "цель не найдена"))
    return total, bad


def main():
    repo = pathlib.Path(__file__).resolve().parents[3]
    failed = False
    for root, cmd_dir in LAYOUTS:
        total, bad = check_layout(repo, root, cmd_dir)
        head = f"{root}/{cmd_dir} + {root}/skills: проверено {total}"
        if bad:
            failed = True
            print(f"{head}, не резолвится {len(bad)}:")
            for path, line, ref, why in bad:
                print(f"    {path}:{line}  {ref} — {why}")
        else:
            print(f"{head}, все резолвятся")
    if failed:
        print("\nФормы ссылок — `skills/bft-writer/SKILL.md` §«Пути к ресурсам после установки».")
        return 1
    print("OK — ссылки резолвятся во всех раскладках install.sh.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
