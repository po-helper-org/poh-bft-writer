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

( cd "$REPO/plugin" && npx tsc -p tsconfig.json ) || { echo "FAIL  плагин не собрался"; exit 1; }

BFT_WORKSPACE_ROOT="$TMP/ws" node --input-type=module -e "
import { loadConfig, scanWorkspace, nodePorts, chooseDocument } from '$REPO/plugin/lib/index.js'
const { tasks, docsPath } = await scanWorkspace(loadConfig(process.env), nodePorts)
console.log(JSON.stringify({ docsPath, tasks: tasks.map(t => ({
  id: t.id, stage: t.stage, title: t.title, html: t.links.html, artifacts: t.artifacts,
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
check "страница ревью распознана и у fast-эпика" \
      "[t for t in d['tasks'] if t['id']=='vibeapp'][0]['artifacts']['html'] is True"

# Файл, на который указывает плагин, обязан существовать на диске.
HTML="$TMP/ws/$(python3 -c "
import json
d = json.load(open('$TMP/scan.json'))
print([t for t in d['tasks'] if t['id']=='direct-faq'][0]['html'])")"
if [ -f "$HTML" ]; then echo "ok    файл по этой ссылке действительно есть"; else
  echo "FAIL  ссылка ведёт в никуда: $HTML"; fails=$((fails + 1)); fi

if [ "$fails" -eq 0 ]; then echo "Все проверки пройдены."; exit 0; fi
echo "Провалов: $fails"; exit 1
