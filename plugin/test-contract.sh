#!/bin/bash
# Контракт между двумя половинами: то, что пишет poh-bft-writer, обязано
# читаться плагином. Проверка идёт на настоящих эталонах и настоящем
# экспортёре, а не на подделках портов — они проверяют логику, а не стык.
#
# Запуск из корня репозитория: bash plugin/test-contract.sh
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fails=0

DOCS="$TMP/ws/.bft/documentation"
mkdir -p "$DOCS/direct-faq" "$DOCS/vibeapp"

# Эпик после /bft-deep: единый документ плюс собранная страница ревью.
cp "$REPO/skills/bft-deep-swarm/examples/golden_deep_document.md" "$DOCS/direct-faq/direct-faq.md"
python3 "$REPO/skills/bft-writer/scripts/bft-html-export.py" "$DOCS/direct-faq/direct-faq.md" >/dev/null 2>&1

# Эпик после одного /bft-fast: только шапка.
cp "$REPO/skills/bft-fast/examples/golden_document.md" "$DOCS/vibeapp/vibeapp-fast.md"
python3 "$REPO/skills/bft-writer/scripts/bft-html-export.py" "$DOCS/vibeapp/vibeapp-fast.md" >/dev/null 2>&1

( cd "$REPO/plugin" && pnpm build >/dev/null ) || { echo "FAIL  плагин не собрался"; exit 1; }

# ── Стык с харнессом ──────────────────────────────────────────────────────────
# Ниже — ровно те два условия, на которых харнесс отказался поднимать раздел при
# первом локальном прогоне. Оба видны только на собранном пакете, поэтому проверка
# живёт здесь, а не в юнит-тестах.

# 1. Cordis грузит плагин по имени пакета и требует у точки входа `apply`.
#    Barrel без реэкспорта plugin.js даёт «invalid plugin, expect function or
#    object with an "apply" method, received object» — и весь харнесс не стартует.
ENTRY="$(node -p "require('$REPO/plugin/package.json').main")"
if node --input-type=module -e "
import { apply, name } from '$REPO/plugin/$ENTRY'
if (typeof apply !== 'function') throw new Error('apply не функция')
if (typeof name !== 'string' || name === '') throw new Error('name пуст')
" 2>/dev/null; then echo "ok    точка входа пакета отдаёт apply и name (иначе cordis не поднимет раздел)"
else echo "FAIL  точка входа пакета не отдаёт apply/name — харнесс не стартует"; fails=$((fails + 1)); fi

# 2. Клиентская половина: exports["./client"] обязан указывать на собранный
#    браузерный бандл. Вывод tsc туда не годится — в нём остаются голые
#    спецификаторы, которые в браузере не разрешаются.
CLIENT="$(node -p "require('$REPO/plugin/package.json').exports['./client'].default")"
CLIENT_FILE="$REPO/plugin/${CLIENT#./}"
if [ -f "$CLIENT_FILE" ]; then echo "ok    клиентский бандл собран по адресу из exports пакета"
else echo "FAIL  нет файла $CLIENT_FILE, на который смотрит exports['./client']"; fails=$((fails + 1)); fi

if grep -q '__ModuleLoader__.load' "$CLIENT_FILE" 2>/dev/null; then
  echo "ok    бандл регистрируется в загрузчике оболочки"
else echo "FAIL  бандл не зовёт __ModuleLoader__.load — оболочка его не подхватит"; fails=$((fails + 1)); fi

# Таблица модулей оболочки конечна: require на что-то вне её — падение в рантайме.
STRAY="$(grep -oE 'require\("[^"]+"\)' "$CLIENT_FILE" 2>/dev/null \
  | sort -u \
  | grep -vE '"(react|react/jsx-runtime|react-dom|react-dom/client|@deepseek-ai/cordis|@deepseek-ai/dsh-client-store|@deepseek-ai/dsh-client-ui-slots|@deepseek-ai/dsh-client-ui-primitives)"' || true)"
if [ -z "$STRAY" ]; then echo "ok    бандл требует только то, что оболочка отдаёт"
else echo "FAIL  бандл требует пакеты вне таблицы модулей: $STRAY"; fails=$((fails + 1)); fi

BFT_WORKSPACE_ROOT="$TMP/ws" BFT_ENTIRE_BASE_URL="https://entire.io/test" node --input-type=module -e "
import { loadConfig, scanWorkspace, nodePorts, chooseDocument } from '$REPO/plugin/lib/index.js'
const { tasks, docsPath } = await scanWorkspace(loadConfig(process.env), nodePorts)
console.log(JSON.stringify({ docsPath, tasks: tasks.map(t => ({
  id: t.id, stage: t.stage, title: t.title, html: t.links.html,
  artifacts: t.artifacts, missing: t.missing,
})) }))
" > "$TMP/scan.json" 2>"$TMP/scan.err" || { echo "FAIL  прогон упал:"; cat "$TMP/scan.err"; exit 1; }

check() {
  if python3 -c "
import json, sys
d = json.load(open('$TMP/scan.json'))
sys.exit(0 if ($2) else 1)
" 2>/dev/null; then echo "ok    $1"; else echo "FAIL  $1"; fails=$((fails + 1)); fi
}

check "каталог документов найден по умолчанию репозитория" "d['docsPath'] == '.bft/documentation'"
check "оба эпика попали в очередь" "len(d['tasks']) == 2"
check "эпик после deep получил стадию DEEP-REVIEW" \
      "[t for t in d['tasks'] if t['id']=='direct-faq'][0]['stage'] == 'DEEP-REVIEW'"
check "эпик после одного fast получил стадию FAST-DONE" \
      "[t for t in d['tasks'] if t['id']=='vibeapp'][0]['stage'] == 'FAST-DONE'"
check "название взято из H1 документа, а не из имени папки" \
      "'Вопрос-ответ' in [t for t in d['tasks'] if t['id']=='direct-faq'][0]['title']"
check "ссылка на страницу ревью указывает на собранный экспортёром файл" \
      "[t for t in d['tasks'] if t['id']=='direct-faq'][0]['html'] == '.bft/documentation/direct-faq/direct-faq.html'"
check "страница ревью fast распознана как своя, а не как страница deep" \
      "[t for t in d['tasks'] if t['id']=='vibeapp'][0]['artifacts'] == {'fast': True, 'fastHtml': True, 'deep': False, 'deepHtml': False}"

# Эталон deep собран, но не отгружен: страницы Confluence и эпика в нём нет.
# Это ровно тот случай, который обязан вернуться в DEEP-REVIEW с объяснением.
check "неполный набор deep назван поимённо, а не просто откатил стадию" \
      "[t for t in d['tasks'] if t['id']=='direct-faq'][0]['missing'] == ['ссылка на страницу Confluence', 'ссылка на эпик JIRA']"

# Файл, на который указывает плагин, обязан существовать на диске.
HTML="$TMP/ws/$(python3 -c "
import json
d = json.load(open('$TMP/scan.json'))
print([t for t in d['tasks'] if t['id']=='direct-faq'][0]['html'])")"
if [ -f "$HTML" ]; then echo "ok    файл по этой ссылке действительно есть"; else
  echo "FAIL  ссылка ведёт в никуда: $HTML"; fails=$((fails + 1)); fi

if [ "$fails" -eq 0 ]; then echo "Все проверки пройдены."; exit 0; fi
echo "Провалов: $fails"; exit 1
