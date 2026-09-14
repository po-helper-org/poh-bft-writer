#!/bin/bash
# Обновить bft-writer, установленный в DeepSeek Harness, до последнего main.
#
# Харнесс держит две половины, и устаревают они по отдельности:
#   * плагин poh-bft-plugin — профиль харнесса ссылается (link:) на plugin/ этого
#     чекаута и грузит собранный lib/; новый код появляется после git pull,
#     pnpm build и перезапуска харнесса;
#   * навыки /bft-* — копия skills/ и commands/ в .claude/ воркспейса, который
#     подключён к харнессу как skill-root; обновляется install.sh.
#
# Скрипт делает обе половины одной командой и в конце проверяет, что харнесс
# поднялся (HTTP 200): несобранный или сломанный плагин роняет весь харнесс, а
# launchd перезапускает его в цикле — «живой агент, мёртвый порт».
#
#   bash update.sh --check                 # только сверить версии, ничего не менять
#   bash update.sh --workspace <корень>    # обновить чекаут, плагин, навыки, перезапустить
#
# Ключи:
#   --workspace <dir>   воркспейс с .claude/skills (по умолчанию — workspaceRoot из
#                       строки bft-requirements в cordis.patch.yml профиля)
#   --dsh-home <dir>    DSH_HOME харнесса (по умолчанию — из окружения живого процесса
#                       dsh web, затем $DSH_HOME, затем ~/.dsh)
#   --profile <name>    профиль харнесса (по умолчанию web)
#   --url <url>         адрес харнесса для проверки (по умолчанию http://127.0.0.1:3082/)
#   --restart-cmd <cmd> команда перезапуска (по умолчанию — launchctl kickstart агента
#                       с «dsh-harness» в имени, если такой есть)
#   --no-restart        не перезапускать (изменения плагина вступят после ручного рестарта)
#   --no-skills         не трогать навыки воркспейса
#   --no-plugin         не собирать плагин
#   --skip-tests        не гонять plugin/test-contract.sh перед перезапуском
#   --check             режим отчёта: версия чекаута против origin/main, куда смотрит
#                       профиль, синхронны ли навыки; код возврата 0 — всё актуально
set -u
REPO="$(cd "$(dirname "$0")" && pwd -P)"
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}ok${NC}    $1"; }
warn() { echo -e "${YELLOW}warn${NC}  $1"; }
fail() { echo -e "${RED}FAIL${NC}  $1"; }
die()  { fail "$1"; exit 1; }

WORKSPACE=""; DSH_HOME_ARG=""; PROFILE="web"; URL="http://127.0.0.1:3082/"
RESTART_CMD=""; DO_RESTART=1; DO_SKILLS=1; DO_PLUGIN=1; DO_TESTS=1; CHECK_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --workspace)   WORKSPACE="$2"; shift ;;
    --dsh-home)    DSH_HOME_ARG="$2"; shift ;;
    --profile)     PROFILE="$2"; shift ;;
    --url)         URL="$2"; shift ;;
    --restart-cmd) RESTART_CMD="$2"; shift ;;
    --no-restart)  DO_RESTART=0 ;;
    --no-skills)   DO_SKILLS=0 ;;
    --no-plugin)   DO_PLUGIN=0 ;;
    --skip-tests)  DO_TESTS=0 ;;
    --check)       CHECK_ONLY=1 ;;
    -h|--help)     sed -n '2,32p' "$0"; exit 0 ;;
    *) die "неизвестный ключ: $1 (см. --help)" ;;
  esac
  shift
done

# ── Где харнесс ──────────────────────────────────────────────────────────────
# DSH_HOME берётся у живого процесса: у launchd своё окружение, и то, что видит
# шелл, может указывать на другой харнесс (например, ~/.dsh соседнего проекта).
harness_pid() { pgrep -f 'apps/cli/src/bin.ts web' 2>/dev/null | head -1; }
if [ -n "$DSH_HOME_ARG" ]; then
  DSH_HOME="$DSH_HOME_ARG"
elif [ -n "$(harness_pid)" ] && ps eww -p "$(harness_pid)" 2>/dev/null | tr ' ' '\n' | grep -q '^DSH_HOME='; then
  DSH_HOME="$(ps eww -p "$(harness_pid)" | tr ' ' '\n' | grep '^DSH_HOME=' | head -1 | cut -d= -f2-)"
else
  DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
fi
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
[ -d "$PROFILE_DIR" ] || die "профиль не найден: $PROFILE_DIR (задайте --dsh-home / --profile)"
echo "харнесс:    DSH_HOME=$DSH_HOME, профиль $PROFILE"

# Куда смотрит профиль: пакет poh-bft-plugin обязан быть ссылкой на plugin/ ЭТОГО чекаута,
# иначе git pull здесь обновит не тот код, который грузит харнесс.
LINKED=""
if [ -e "$PROFILE_DIR/node_modules/poh-bft-plugin" ]; then
  LINKED="$(cd "$PROFILE_DIR/node_modules/poh-bft-plugin" 2>/dev/null && pwd -P)"
fi
if [ -z "$LINKED" ]; then
  warn "в профиле нет пакета poh-bft-plugin — установка по docs/guides/dsh-plugin-setup.md"
elif [ "$LINKED" != "$REPO/plugin" ]; then
  die "профиль грузит плагин из другого чекаута: $LINKED — обновляйте его (bash $LINKED/../update.sh), а не этот"
else
  ok "профиль грузит плагин из этого чекаута: $REPO/plugin"
fi

# Воркспейс с навыками — из строки bft-requirements профиля, если не задан явно.
if [ -z "$WORKSPACE" ] && [ -f "$PROFILE_DIR/cordis.patch.yml" ]; then
  WORKSPACE="$(awk '/^- id: bft-requirements/{f=1} f && /workspaceRoot:/{gsub(/.*workspaceRoot:[ ]*/,""); gsub(/^[\x27"]|[\x27"][ ]*$/,""); print; exit}' "$PROFILE_DIR/cordis.patch.yml")"
fi
if [ -n "$WORKSPACE" ] && [ -d "$WORKSPACE" ]; then
  echo "воркспейс:  $WORKSPACE"
else
  [ "$DO_SKILLS" -eq 1 ] && warn "воркспейс не найден ($WORKSPACE) — навыки не обновляются; задайте --workspace"
  DO_SKILLS=0
fi

# ── Версии ───────────────────────────────────────────────────────────────────
cd "$REPO"
git fetch -q origin main 2>/dev/null || warn "git fetch origin main не удался — сравниваю с тем, что уже скачано"
LOCAL="$(git rev-parse --short HEAD)"
REMOTE="$(git rev-parse --short origin/main 2>/dev/null || echo '?')"
BEHIND="$(git rev-list --count HEAD..origin/main 2>/dev/null || echo '?')"
AHEAD="$(git rev-list --count origin/main..HEAD 2>/dev/null || echo '?')"
BRANCH="$(git branch --show-current)"
DIRTY="$(git status --porcelain --untracked-files=no | wc -l | tr -d ' ')"
echo "чекаут:     $LOCAL ($BRANCH, $(git log -1 --format=%cs HEAD)); origin/main $REMOTE ($(git log -1 --format=%cs origin/main 2>/dev/null || echo '?')); отстаёт на $BEHIND, впереди на $AHEAD"

skills_in_sync() {
  # Навык актуален, когда каждый SKILL.md и каждая команда контура совпадают с чекаутом байт в байт.
  local root="$1/.claude" s c
  [ -d "$root/skills" ] || return 1
  for s in "$REPO"/skills/*/; do
    s="$(basename "$s")"
    [ -f "$REPO/skills/$s/SKILL.md" ] || continue
    cmp -s "$REPO/skills/$s/SKILL.md" "$root/skills/$s/SKILL.md" || return 1
  done
  for c in $(sed -n 's/^COMMANDS="\(.*\)"$/\1/p' "$REPO/install.sh"); do
    cmp -s "$REPO/commands/$c.md" "$root/commands/$c.md" || return 1
  done
  return 0
}
lib_fresh() {
  # lib/ собран из текущих исходников: не старше самого нового файла в src/ и package.json.
  [ -f "$REPO/plugin/lib/index.js" ] && [ -f "$REPO/plugin/lib/client.js" ] || return 1
  [ -z "$(find "$REPO/plugin/src" "$REPO/plugin/package.json" -newer "$REPO/plugin/lib/client.js" 2>/dev/null | head -1)" ]
}

if [ "$CHECK_ONLY" -eq 1 ]; then
  rc=0
  if [ "$BEHIND" = "0" ]; then ok "чекаут на последнем main"; else fail "чекаут отстаёт от origin/main на $BEHIND коммит(ов)"; rc=1; fi
  if [ "$BRANCH" != "main" ]; then warn "чекаут на ветке $BRANCH, не main"; fi
  if [ "$DIRTY" != "0" ]; then warn "в чекауте незакоммиченные изменения ($DIRTY файлов)"; fi
  if lib_fresh; then ok "plugin/lib собран из текущих исходников"; else fail "plugin/lib отсутствует или старше исходников — pnpm build и перезапуск"; rc=1; fi
  if [ "$DO_SKILLS" -eq 1 ]; then
    if skills_in_sync "$WORKSPACE"; then ok "навыки в $WORKSPACE/.claude совпадают с чекаутом"; else fail "навыки в $WORKSPACE/.claude отстают от чекаута"; rc=1; fi
  fi
  code="$(curl -s -o /dev/null -w '%{http_code}' "$URL" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then ok "харнесс отвечает $code на $URL"; else warn "харнесс не отвечает на $URL ($code)"; fi
  exit "$rc"
fi

# ── Чекаут → последний main ──────────────────────────────────────────────────
if [ "$DIRTY" != "0" ]; then
  die "в чекауте незакоммиченные изменения — закоммитьте или уберите их (git stash), потом повторите"
fi
if [ "$BRANCH" != "main" ]; then
  die "чекаут на ветке $BRANCH; харнесс должен грузить main: git checkout main, потом повторите"
fi
if [ "$BEHIND" = "0" ]; then
  ok "чекаут уже на последнем main ($LOCAL)"
else
  git pull -q --ff-only origin main || die "git pull --ff-only не прошёл — разберите ветку руками"
  ok "чекаут обновлён: $LOCAL → $(git rev-parse --short HEAD)"
fi

# ── Плагин ───────────────────────────────────────────────────────────────────
if [ "$DO_PLUGIN" -eq 1 ]; then
  ( cd "$REPO/plugin" && pnpm install --frozen-lockfile --silent ) || die "pnpm install в plugin/ не прошёл"
  ( cd "$REPO/plugin" && pnpm build >/dev/null ) || die "pnpm build в plugin/ не прошёл — харнесс перезапускать нельзя"
  [ -f "$REPO/plugin/lib/index.js" ] && [ -f "$REPO/plugin/lib/client.js" ] || die "после сборки нет lib/index.js или lib/client.js"
  ok "плагин собран: lib/index.js + lib/client.js"
  if [ "$DO_TESTS" -eq 1 ]; then
    if bash "$REPO/plugin/test-contract.sh" >/tmp/bft-update-contract.log 2>&1; then
      ok "контракт с экспортёром и доской пройден (plugin/test-contract.sh)"
    else
      tail -15 /tmp/bft-update-contract.log
      die "plugin/test-contract.sh провалился — харнесс не перезапускаю"
    fi
  fi
fi

# ── Навыки воркспейса ────────────────────────────────────────────────────────
if [ "$DO_SKILLS" -eq 1 ]; then
  ( cd "$WORKSPACE" && BFT_WRITER_SRC="$REPO" BFT_WRITER_AGENT=1 bash "$REPO/install.sh" >/dev/null 2>&1 </dev/null ) \
    || die "install.sh не прошёл в $WORKSPACE"
  if skills_in_sync "$WORKSPACE"; then ok "навыки в $WORKSPACE/.claude обновлены"; else die "навыки после install.sh не совпадают с чекаутом"; fi
fi

# ── Перезапуск и проверка ────────────────────────────────────────────────────
if [ "$DO_RESTART" -eq 0 ] || [ "$DO_PLUGIN" -eq 0 ]; then
  warn "харнесс не перезапущен — плагин подхватится после перезапуска"
  exit 0
fi
if [ -z "$RESTART_CMD" ]; then
  LABEL="$(launchctl list 2>/dev/null | awk '{print $3}' | grep 'dsh-harness' | head -1)"
  if [ -n "$LABEL" ]; then RESTART_CMD="launchctl kickstart -k gui/$(id -u)/$LABEL"; fi
fi
if [ -z "$RESTART_CMD" ]; then
  warn "не знаю, как перезапустить харнесс: задайте --restart-cmd или перезапустите dsh web руками"
  exit 0
fi
echo "перезапуск: $RESTART_CMD"
LOG=/tmp/dsh-harness-ui.log; before=0; [ -f "$LOG" ] && before="$(wc -l < "$LOG" | tr -d ' ')"
eval "$RESTART_CMD" || die "команда перезапуска вернула ошибку"
code=000
for i in $(seq 1 12); do
  sleep 5
  code="$(curl -s -o /dev/null -w '%{http_code}' "$URL" 2>/dev/null || echo 000)"
  [ "$code" = "200" ] && break
done
if [ "$code" != "200" ]; then
  [ -f "$LOG" ] && tail -n 40 "$LOG"
  die "харнесс не поднялся на $URL ($code) — смотрите лог выше"
fi
ok "харнесс поднялся: $code на $URL"
if [ -f "$LOG" ] && tail -n "+$((before + 1))" "$LOG" | grep -qi 'invalid plugin\|poh-bft-plugin.*error'; then
  tail -n "+$((before + 1))" "$LOG" | grep -i 'invalid plugin\|poh-bft-plugin' | head -5
  die "в логе харнесса ошибка плагина"
fi
echo -e "${GREEN}Готово:${NC} bft-writer $(git rev-parse --short HEAD) в харнессе. Открытая вкладка получит новый токен — перезайдите по ссылке из $LOG."
