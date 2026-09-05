#!/bin/bash
# Два режима на одном чекауте не мешают друг другу.
#
# Проверка нужна именно машинная: «плагин лежит отдельным каталогом» — это
# договорённость, которую легко нарушить одной строкой в install.sh или одним
# путём в линтере, и заметить это по обзору кода почти невозможно.
#
# Запуск из корня репозитория: bash plugin/test-dual-mode.sh
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fails=0

ok()   { echo "ok    $1"; }
fail() { echo "FAIL  $1"; fails=$((fails + 1)); }

# ---------- режим скиллов ----------
mkdir -p "$TMP/agent"
cp -r "$REPO"/commands "$REPO"/skills "$REPO"/install.sh "$REPO"/bft-config.template.md "$TMP/agent/" 2>/dev/null
( cd "$TMP/agent" && bash install.sh >/dev/null 2>&1 </dev/null )

cmds=$(ls -1 "$TMP/agent/.claude/commands" 2>/dev/null | wc -l)
skls=$(ls -1 "$TMP/agent/.claude/skills" 2>/dev/null | wc -l)
[ "$cmds" -eq 8 ] && ok "install.sh поставил восемь команд контура" \
  || fail "команд установлено $cmds, ожидалось 8"
[ "$skls" -eq 5 ] && ok "install.sh поставил пять навыков" \
  || fail "навыков установлено $skls, ожидалось 5"

# Главное: установка для IDE-агента не должна ничего знать о плагине.
if find "$TMP/agent/.claude" -iname "*plugin*" -o -iname "*.ts" -o -iname "package.json" 2>/dev/null | grep -q .; then
  fail "в установку скиллов затёк плагин — режимы перестали быть независимыми"
else
  ok "в установке скиллов плагина нет: режимы независимы"
fi

# Установленная раскладка обязана остаться рабочей.
if python3 "$TMP/agent/.claude/skills/bft-writer/scripts/bft-lint.py" \
     "$REPO/skills/bft-fast/examples/golden_document.md" >/dev/null 2>&1; then
  ok "линтер из установленной раскладки работает"
else
  fail "линтер из установленной раскладки сломан"
fi

# ---------- режим плагина ----------
( cd "$REPO/plugin" && npx tsc -p tsconfig.json >/dev/null 2>&1 ) \
  && ok "плагин собирается" || fail "плагин не собрался"

# Плагин не должен зависеть от раскладки агента: он читает воркспейс, а не .claude.
if grep -rn "\.claude\|\.agents\|\.clinerules" "$REPO/plugin/src" >/dev/null 2>&1; then
  fail "плагин ссылается на раскладку IDE-агента — это связало бы режимы"
else
  ok "плагин не знает про раскладку IDE-агента"
fi

# И наоборот: канон контура не должен упоминать плагин как обязательный шаг.
if grep -rln "poh-bft-plugin\|BFT_WORKSPACE_ROOT" "$REPO/commands" "$REPO/skills" >/dev/null 2>&1; then
  fail "команды или навыки требуют плагина — режим скиллов перестал быть самостоятельным"
else
  ok "команды и навыки работают без плагина"
fi

if [ "$fails" -eq 0 ]; then echo "Все проверки пройдены."; exit 0; fi
echo "Провалов: $fails"; exit 1
