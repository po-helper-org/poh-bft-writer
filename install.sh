#!/bin/bash
set -e
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
REPO_URL="https://github.com/kibarik/poh-bft-writer.git"

# Источник: если запущено из клона — текущая папка; если через curl — клонируем
if [ -d "./commands" ] && [ -d "./skills" ]; then
  SRC="."
else
  echo -e "${BLUE}Клонирую poh-bft-writer…${NC}"
  TEMP_DIR="$(mktemp -d)"
  git clone --depth 1 "$REPO_URL" "$TEMP_DIR"
  SRC="$TEMP_DIR"
fi

echo -e "${BLUE}Какой IDE-агент?${NC}"
echo "  1) Claude Code   (.claude/)"
echo "  2) Codex         (.agents/)"
echo "  3) Cline         (.clinerules/)"
echo "  4) DevX (МТС)    (.clinerules/)"
echo "  5) Universal     (.agents/)"
if [ -r /dev/tty ]; then
  read -rp "Выбор [1]: " choice < /dev/tty 2>/dev/null || choice=""
else
  choice=""
fi
choice="${choice:-1}"
case "$choice" in
  1) ROOT=".claude";     CMD_DIR="commands" ;;
  2) ROOT=".agents";     CMD_DIR="prompts" ;;
  3) ROOT=".clinerules"; CMD_DIR="workflows" ;;
  4) ROOT=".clinerules"; CMD_DIR="workflows" ;;
  5) ROOT=".agents";     CMD_DIR="commands" ;;
  *) echo "Неизвестный выбор"; exit 1 ;;
esac

# Синк команд
mkdir -p "$ROOT/$CMD_DIR"
cp -R "$SRC"/commands/. "$ROOT/$CMD_DIR"/

# Синк навыков с инъекцией frontmatter (name + description из первой строки SKILL.md)
mkdir -p "$ROOT/skills"
for skill_src in "$SRC"/skills/*; do
  [ -d "$skill_src" ] || continue
  [ -f "$skill_src/SKILL.md" ] || continue
  skill_name="$(basename "$skill_src")"
  skill_dst="$ROOT/skills/$skill_name"
  mkdir -p "$skill_dst"
  cp -R "$skill_src"/. "$skill_dst"/
  # description = первая '# '-строка SKILL.md; если frontmatter уже есть — не дублируем
  if ! head -1 "$skill_src/SKILL.md" | grep -q '^---$'; then
    desc="$(sed -n '1s/^# *//p;q' "$skill_src/SKILL.md")"
    desc="${desc:-$skill_name}"
    desc="${desc//\\/\\\\}"; desc="${desc//\"/\\\"}"
    { printf -- '---\nname: %s\ndescription: "%s"\n---\n' "$skill_name" "$desc"; sed '1d' "$skill_src/SKILL.md"; } > "$skill_dst/SKILL.md"
  fi
done

# Конфиг-шаблон в корень (если ещё нет)
[ -f bft-config.md ] || cp "$SRC/bft-config.template.md" ./bft-config.template.md 2>/dev/null || true

[ "$SRC" = "$TEMP_DIR" ] && rm -rf "$TEMP_DIR"

echo -e "${GREEN}✔ Установлено в $ROOT/${NC}"
echo -e "${YELLOW}Следующий шаг:${NC} запусти ${GREEN}/bft-index${NC} — навык построит контекст воркспейса."
