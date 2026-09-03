#!/bin/bash
# Самотест HTML-экспортёра: страница собирается и для fast-документа (шапка без
# канона), и для deep; служебные HTML-комментарии на страницу не попадают.
# Запуск из корня репозитория: bash skills/bft-writer/scripts/test-bft-html-export.sh
set -u

EXPORT="skills/bft-writer/scripts/bft-html-export.py"
FAST="skills/bft-fast/examples/golden_document.md"
DEEP="skills/bft-deep-swarm/examples/golden_deep_document.md"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fails=0

render() {
  local src="$1" name="$2"
  cp "$src" "$TMP/$name.md"
  if python3 "$EXPORT" "$TMP/$name.md" >/dev/null 2>&1 && [ -f "$TMP/$name.html" ]; then
    echo "ok    собрана страница для $name ($src)"
  else
    echo "FAIL  страница для $name не собралась ($src)"
    fails=$((fails + 1))
    return 1
  fi
}

# Стадия fast — шапка без канона: экспортёр обязан её переварить, иначе
# авто-генерация после /bft-fast (ЗМ-033) падала бы на каждом прогоне.
render "$FAST" "epic-fast" && {
  if grep -q "&lt;!--" "$TMP/epic-fast.html"; then
    echo "FAIL  служебный HTML-комментарий виден на странице — в .md он читателю невидим"
    fails=$((fails + 1))
  else
    echo "ok    служебные комментарии на страницу не попали"
  fi
  # Содержимое при этом не должно пострадать: точки [УТОЧНИТЬ] — смысл страницы ревью.
  src_count=$(grep -oE "УТОЧНИТЬ" "$FAST" | wc -l)
  html_count=$(grep -oE "УТОЧНИТЬ" "$TMP/epic-fast.html" | wc -l)
  if [ "$html_count" -ge "$src_count" ]; then
    echo "ok    точки [УТОЧНИТЬ] сохранены ($html_count при $src_count в исходнике)"
  else
    echo "FAIL  часть [УТОЧНИТЬ] потерялась: $html_count при $src_count в исходнике"
    fails=$((fails + 1))
  fi
}

# Стадия deep — полный канон с диаграммой.
render "$DEEP" "epic" && {
  if grep -q "mermaid" "$TMP/epic.html"; then
    echo "ok    диаграмма «Плана демонстрации» отрендерена"
  else
    echo "FAIL  в deep-документе не нашлось диаграммы"
    fails=$((fails + 1))
  fi
}

if [ "$fails" -eq 0 ]; then
  echo "Все проверки пройдены."
  exit 0
fi
echo "Провалов: $fails"
exit 1
