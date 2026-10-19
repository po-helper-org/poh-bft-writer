#!/bin/bash
# Самотест подготовки тела страницы Confluence для матрицы исполнения (/bft-deliver --matrix).
# Запуск из корня репозитория: bash skills/bft-writer/scripts/test-bft-matrix-publish.sh
set -u

PUB="skills/bft-writer/scripts/bft-matrix-publish.py"
GOLDEN="skills/bft-exec-matrix/examples/golden_exec_matrix.md"
fails=0

out=$(python3 "$PUB" "$GOLDEN")
rc=$?
check() {  # $1 — ожидаемое (grep -F), $2 — описание
  if echo "$out" | grep -qF -- "$1"; then echo "ok    $2"; else echo "FAIL  $2"; fails=$((fails + 1)); fi
}
absent() {  # $1 — запрещённое (grep -E), $2 — описание
  if echo "$out" | grep -qE -- "$1"; then echo "FAIL  $2"; fails=$((fails + 1)); else echo "ok    $2"; fi
}

[ $rc -eq 0 ] && echo "ok    тело собрано" || { echo "FAIL  код выхода $rc"; fails=$((fails + 1)); }
absent '^(epic_slug|source_rev|stage):' "frontmatter на страницу не попал"
absent '^# \[Матрица исполнения\]' "H1 не дублирует заголовок страницы"
check "Страница собрана из матрицы PO" "страница предупреждает: правки в Confluence перезапишутся"
check "версия 1" "версия матрицы видна командам"
check "| Команда | Режим | Строк | ✓ Принято |" "сводка исполнения по командам"
check "| Direct | DO-CONFIRM | 4 | 1 | 0 | 1 | 0 | 1 / 1 |" "сводка считает строки и возвраты команды"
check "| ↩ Возврат |" "статус строки — со знаком"
check "| ✓ Принято 23.10.2026 |" "принятая строка — со знаком и датой"
check "- ☑ " "выполненный пункт чеклиста — галочкой"
check "- ☐ " "открытый пункт чеклиста — пустым квадратом"
absent '^- \[[ xX]\]' "разметка задач Markdown не осталась (в Confluence она стала бы чужими задачами)"
check "## Журнал возвратов" "журнал возвратов публикуется"

# Черновик публикуется только на согласование — страница говорит это прямо.
draft=$(sed 's/^status: в исполнении$/status: черновик/' "$GOLDEN" | python3 "$PUB" -)
if echo "$draft" | grep -qF "Черновик на согласование"; then
  echo "ok    черновик помечен как черновик на согласование"
else
  echo "FAIL  черновик не помечен"
  fails=$((fails + 1))
fi

[ $fails -eq 0 ] && echo "PASS  bft-matrix-publish" || echo "FAIL  bft-matrix-publish: $fails"
exit $fails
