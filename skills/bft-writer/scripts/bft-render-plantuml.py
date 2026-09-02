#!/usr/bin/env python3
"""Рендер ```plantuml``` блоков БФТ-документа в PNG (ЗМ-015).

Блок не публикуется кодом и не полагается на плагин Confluence: каждый
```plantuml``` рендерится в PNG заранее, PNG грузится вложением на уже
созданную/обновляемую страницу, а в теле на месте диаграммы остаётся
плейсхолдер `[[PLANTUML-N]]`, который вызывающий (агент `/bft-deliver`)
меняет на `<ac:image>` после того, как вложение реально загружено и
известно его точное имя (Confluence может нормализовать имя файла).

Порядок рендера (первый доступный побеждает):
  1. `plantuml` CLI (+ Graphviz) — локально
  2. `docker run --rm plantuml/plantuml` — если доступен docker
Ни один не доступен → выходит с ошибкой и списком `[УТОЧНИТЬ: нет рендерера
PlantUML]` для каждого блока — код не публикуется молча вместо диаграммы.

Использование:
    python3 bft-render-plantuml.py <путь-к-epic.md> --out-dir diagrams/
Печатает в stdout:
  - тело документа с плейсхолдерами `[[PLANTUML-N]]` вместо фенс-блоков
  - в stderr — манифест: индекс → путь к PNG (или УТОЧНИТЬ, если рендер не удался)
Код возврата 0, только если ВСЕ блоки отрендерены.
"""
import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

PLANTUML_BLOCK_RE = re.compile(r"```plantuml\n(.*?)```", re.S)


def find_renderer():
    if shutil.which("plantuml"):
        return "cli"
    if shutil.which("docker"):
        return "docker"
    return None


def render_one(body: str, out_path: Path, renderer: str) -> bool:
    puml_path = out_path.with_suffix(".puml")
    puml_path.write_text(body, encoding="utf-8")
    try:
        if renderer == "cli":
            subprocess.run(["plantuml", "-tpng", str(puml_path)], check=True, capture_output=True, timeout=60)
        elif renderer == "docker":
            subprocess.run(
                [
                    "docker", "run", "--rm",
                    "-v", f"{puml_path.parent}:/w",
                    "plantuml/plantuml", "-tpng", f"/w/{puml_path.name}",
                ],
                check=True, capture_output=True, timeout=120,
            )
        return puml_path.with_suffix(".png").exists()
    except Exception:
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("md_path")
    ap.add_argument("--out-dir", required=True)
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    text = Path(args.md_path).read_text(encoding="utf-8")
    blocks = PLANTUML_BLOCK_RE.findall(text)

    if not blocks:
        print(text)
        print("Нет ```plantuml``` блоков — рендерить нечего.", file=sys.stderr)
        return

    renderer = find_renderer()
    manifest = []
    ok_all = True

    if renderer is None:
        for i in range(1, len(blocks) + 1):
            manifest.append(f"{i}: [УТОЧНИТЬ: нет рендерера PlantUML — не найден ни plantuml CLI, ни docker]")
        ok_all = False
    else:
        for i, body in enumerate(blocks, start=1):
            png_path = out_dir / f"diagram-{i}.png"
            ok = render_one(body, out_dir / f"diagram-{i}", renderer)
            if ok:
                manifest.append(f"{i}: {png_path}")
            else:
                manifest.append(f"{i}: [УТОЧНИТЬ: рендер diagram-{i} упал ({renderer})]")
                ok_all = False

    result_text, n = PLANTUML_BLOCK_RE.subn(
        lambda m, c=[0]: (c.__setitem__(0, c[0] + 1), f"[[PLANTUML-{c[0]}]]")[1], text
    )

    print(result_text)
    print(f"── Манифест рендера ({renderer or 'нет рендерера'}) ──", file=sys.stderr)
    for line in manifest:
        print(line, file=sys.stderr)

    sys.exit(0 if ok_all else 1)


if __name__ == "__main__":
    main()
