#!/bin/bash
# Самотест HTML-экспортёра: страница собирается и для fast-документа (шапка без
# канона), и для deep; служебные HTML-комментарии на страницу не попадают.
# Запуск из корня репозитория: bash skills/bft-writer/scripts/test-bft-html-export.sh
set -u

EXPORT="skills/bft-writer/scripts/bft-html-export.py"
FAST="skills/bft-fast/examples/golden_document.md"
DEEP="skills/bft-deep-swarm/examples/golden_deep_document.md"
# Документ со старой разметкой заголовков — фикстура обратной совместимости.
LEGACY="skills/bft-writer/scripts/fixtures/broken_document.md"
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

  # Открытое поле адресовано следующему прогону, а не читателю: на странице оно
  # свёрнуто, а его <details>/<summary> — разметка, не экранированный текст (ЗМ-039).
  if grep -q '<details class="fold"><summary><h2' "$TMP/epic-fast.html"; then
    echo "ok    служебный раздел свёрнут, заголовок остался якорем оглавления"
  else
    echo "FAIL  служебный раздел не свёрнут"
    fails=$((fails + 1))
  fi
  if grep -q "&lt;details&gt;\|&lt;summary&gt;" "$TMP/epic-fast.html"; then
    echo "FAIL  теги details/summary вылезли на страницу текстом"
    fails=$((fails + 1))
  else
    echo "ok    теги details/summary отданы разметкой"
  fi

  # Источник в таблице требований показывается сноской, полный текст — в подвале
  # страницы, и ссылка ведёт в обе стороны (ЗМ-045).
  if grep -q 'class="src-ref" id="src-ref-1" href="#src-note-1"' "$TMP/epic-fast.html" \
     && grep -q '<li id="src-note-1">' "$TMP/epic-fast.html" \
     && grep -q 'class="src-back" href="#src-ref-1"' "$TMP/epic-fast.html"; then
    echo "ok    источник ушёл сноской в подвал, ссылка двусторонняя"
  else
    echo "FAIL  сноска на источник или обратная ссылка не построены"
    fails=$((fails + 1))
  fi
  if grep -q '<h2 id="sec-sources">Источники</h2>' "$TMP/epic-fast.html"; then
    echo "ok    раздел «Источники» на странице есть"
  else
    echo "FAIL  раздела «Источники» нет"
    fails=$((fails + 1))
  fi

  # Круг правок закрывается по хэшу содержимого документа (ЗМ-047): без него
  # страница не отличит пересобранный документ от прежнего, и замечания
  # прошлой итерации уедут в промт повторно.
  if grep -qE 'var DOC_REV = "[0-9a-f]{12}"' "$TMP/epic-fast.html"; then
    echo "ok    ревизия документа зашита в страницу"
  else
    echo "FAIL  ревизии документа на странице нет — круг правок не закроется"
    fails=$((fails + 1))
  fi
  # Кнопка отгрузки — прямой ребёнок угловой панели и стоит ДО «Комментариев»:
  # внутри списка комментариев её не видно, пока панель не открыта (ЗМ-049).
  if grep -q '<button class="shipbtn" id="shipBtn"' "$TMP/epic-fast.html" \
     && grep -q 'var EPIC = ' "$TMP/epic-fast.html" \
     && python3 - "$TMP/epic-fast.html" <<'PYEOF'
import re, sys
h = open(sys.argv[1], encoding="utf-8").read()
box = re.search(r'<div class="promptbox">(.*?)<div class="panel"', h, re.S).group(1)
sys.exit(0 if box.index('id="shipBtn"') < box.index('id="panelToggle"') else 1)
PYEOF
  then
    echo "ok    кнопка отгрузки в углу над «Комментариями», эпик подставлен"
  else
    echo "FAIL  кнопки отгрузки или эпика нет"
    fails=$((fails + 1))
  fi

  # Снятое стандартом не должно вернуться на страницу (ЗМ-034, ЗМ-035).
  for token in 'class="meta-line"' 'Статус проработки'; do
    if grep -q "$token" "$TMP/epic-fast.html"; then
      echo "FAIL  на странице снова появилось: $token"
      fails=$((fails + 1))
    else
      echo "ok    снятое не вернулось: $token"
    fi
  done
}

# Стадия deep — полный канон с диаграммой.
render "$DEEP" "epic" && {
  if grep -q "mermaid" "$TMP/epic.html"; then
    echo "ok    диаграмма «Плана демонстрации» отрендерена"
  else
    echo "FAIL  в deep-документе не нашлось диаграммы"
    fails=$((fails + 1))
  fi

  if grep -q '<details class="fold"><summary><h2' "$TMP/epic.html"; then
    echo "ok    раздел «Продолжить / уточнить БФТ» свёрнут"
  else
    echo "FAIL  раздел «Продолжить / уточнить БФТ» не свёрнут"
    fails=$((fails + 1))
  fi

  # «Якоря истины» — сам подвал документа: оборачивать его сносками незачем.
  if grep -q 'class="src-ref"' "$TMP/epic.html"; then
    echo "FAIL  раздел-подвал «Якоря истины» обёрнут сносками"
    fails=$((fails + 1))
  else
    echo "ok    подвал документа сносками не обёрнут"
  fi

  # Сам канон пишется решётками (ЗМ-038), в эталоне подчёркиваний быть не должно.
  if grep -qE "^={3,}$" "$DEEP"; then
    echo "FAIL  в эталоне канона снова появилось подчёркивание вместо ##"
    fails=$((fails + 1))
  else
    echo "ok    канон эталона размечен решётками"
  fi
}

# Совместимость со старым: документы, написанные до ЗМ-038, несут заголовки
# подчёркиванием. Экспортёр обязан их разбирать — иначе весь канон таких
# документов уедет абзацем вместе с «====» и выпадет из оглавления (ЗМ-037).
render "$LEGACY" "legacy" && {
  setext_count=$(grep -cE "^={3,}$" "$LEGACY")
  head_count=$(grep -oE "<h2 id=\"sec-[0-9]+\"" "$TMP/legacy.html" | wc -l)
  if [ "$head_count" -ge "$setext_count" ]; then
    echo "ok    старая разметка разобрана ($head_count h2 при $setext_count подчёркиваниях)"
  else
    echo "FAIL  заголовки-подчёркивания не разобраны: $head_count h2 при $setext_count подчёркиваниях"
    fails=$((fails + 1))
  fi
  if grep -qE "<p>[^<]*={3,}" "$TMP/legacy.html"; then
    echo "FAIL  подчёркивание «====» вылезло на страницу абзацем"
    fails=$((fails + 1))
  else
    echo "ok    подчёркивание «====» на страницу не вылезло"
  fi

  # Голые упоминания внешних систем в старом документе страница линкует сама
  # (ЗМ-041): гейт LN001/LN002 бережёт новые документы, но не переписывает
  # написанные раньше — читателю нужен переход, а не сверка ключа глазами.
  if grep -q 'href="https://jira.mts.ru/browse/GDSLV-1409"' "$TMP/legacy.html"; then
    echo "ok    голый ключ трекера стал ссылкой в JIRA"
  else
    echo "FAIL  голый ключ трекера ссылкой не стал"
    fails=$((fails + 1))
  fi
  if grep -q 'viewpage.action?pageId=1777883376"' "$TMP/legacy.html"; then
    echo "ok    голый pageId стал ссылкой в Confluence"
  else
    echo "FAIL  голый pageId ссылкой не стал"
    fails=$((fails + 1))
  fi
  # Стандарты и кодировки той же формы ссылкой стать не должны.
  if grep -qE 'href="https://jira[^"]*(UTF-8|RFC-4180)"' "$TMP/legacy.html"; then
    echo "FAIL  UTF-8/RFC-4180 приняты за ключ трекера"
    fails=$((fails + 1))
  else
    echo "ok    стандарты формы ключа ссылкой не стали"
  fi
  # Вложенная ссылка = сломанная разметка: считаем открывающие и закрывающие.
  opens=$(grep -o "<a " "$TMP/legacy.html" | wc -l)
  closes=$(grep -o "</a>" "$TMP/legacy.html" | wc -l)
  if [ "$opens" -eq "$closes" ] && ! grep -qE "<a [^>]*>[^<]*<a " "$TMP/legacy.html"; then
    echo "ok    ссылки не вложены друг в друга ($opens шт.)"
  else
    echo "FAIL  вложенная или незакрытая ссылка: <a $opens, </a> $closes"
    fails=$((fails + 1))
  fi
}

if [ "$fails" -eq 0 ]; then
  echo "Все проверки пройдены."
  exit 0
fi
echo "Провалов: $fails"
exit 1
