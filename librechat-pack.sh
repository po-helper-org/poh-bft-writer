#!/bin/bash
# librechat-pack — собрать то, что загружается в LibreChat руками, без прав админа.
#
# Выход (dist/librechat/):
#   <навык>.zip            — бандл Agent Skill (SKILL.md на один уровень вглубь)
#   instructions-<навык>.md — профиль LibreChat + тело SKILL.md: вставляется в поле
#                             Instructions агента, если Skills в инстансе выключены
#
# Гайд: docs/guides/librechat-user-setup.md
set -e
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'

SRC="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$SRC/dist/librechat}"
PROFILE="$SRC/docs/guides/librechat/agent-profile.md"

[ -d "$SRC/skills" ] || { echo "Не найден $SRC/skills — запускать из клона репозитория"; exit 1; }
command -v zip >/dev/null || { echo "Нужен zip: brew install zip / apt install zip"; exit 1; }

mkdir -p "$OUT"
# Абсолютный путь обязателен: бандл архивируется из $SRC/skills (иначе SKILL.md ляжет
# слишком глубоко), и относительный $OUT резолвился бы уже от него.
OUT="$(cd "$OUT" && pwd)"
echo -e "${BLUE}Собираю в $OUT${NC}"

for skill_src in "$SRC"/skills/*/; do
  name="$(basename "$skill_src")"
  [ -f "$skill_src/SKILL.md" ] || continue

  # Бандл: архивируется из skills/, чтобы внутри был <навык>/SKILL.md — LibreChat
  # принимает SKILL.md в корне архива или на один уровень вглубь, не глубже.
  rm -f "$OUT/$name.zip"
  (cd "$SRC/skills" && zip -qr "$OUT/$name.zip" "$name")

  # Инструкция для агента: профиль окружения + тело SKILL.md без frontmatter
  # (frontmatter нужен формату навыка, в поле Instructions он только мешает).
  {
    [ -f "$PROFILE" ] && sed '/^<!--/,/-->$/d' "$PROFILE"
    echo
    awk 'BEGIN{fm=0} NR==1 && /^---$/ {fm=1; next} fm==1 && /^---$/ {fm=0; next} fm==0 {print}' "$skill_src/SKILL.md"
  } > "$OUT/instructions-$name.md"

  # Размеры — в килобайтах: wc -m без UTF-8-локали считает байты, а не символы,
  # и на кириллице завышает вдвое.
  printf "  %-16s %4s КБ zip   %4s КБ инструкция\n" "$name" \
    "$(( ($(wc -c < "$OUT/$name.zip") + 512) / 1024 ))" \
    "$(( ($(wc -c < "$OUT/instructions-$name.md") + 512) / 1024 ))"
done

echo -e "${GREEN}✔ Готово${NC}"
echo -e "Есть Skills в LibreChat  → грузить ${GREEN}<навык>.zip${NC} (Skills → + → Upload a skill)."
echo -e "Skills выключены         → ${GREEN}instructions-<навык>.md${NC} в поле Instructions агента."
echo -e "${YELLOW}Минимум для первого прогона:${NC} bft-fast (+ bft-writer как база канона)."
