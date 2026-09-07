#!/bin/bash
# Самотест страницы интервью: страница собирается из эталона, все вопросы стали
# карточками, а ключ ответа переживает пересборку скрипта.
# Запуск из корня репозитория: bash skills/bft-writer/scripts/test-bft-custdev-export.sh
set -u

EXPORT="skills/bft-writer/scripts/bft-custdev-export.py"
GOLDEN="skills/bft-custdev/examples/golden_custdev_script.md"
BROKEN="skills/bft-writer/scripts/fixtures/broken_custdev_script.md"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fails=0

cp "$GOLDEN" "$TMP/epic-custdev.md"
if python3 "$EXPORT" "$TMP/epic-custdev.md" >/dev/null 2>&1 && [ -f "$TMP/epic-custdev.html" ]; then
  echo "ok    страница собрана из эталона"
else
  echo "FAIL  страница из эталона не собралась"
  exit 1
fi
PAGE="$TMP/epic-custdev.html"

# Число карточек = вопросы скрипта плюс вопросы дополнительных гипотез. Потеря
# карточки означает, что вопрос на встрече не зададут вовсе.
cards=$(grep -c "<article class='card'" "$PAGE")
if [ "$cards" -ge 30 ]; then
  echo "ok    вопросы стали карточками ($cards шт.)"
else
  echo "FAIL  карточек всего $cards — часть вопросов потерялась"
  fails=$((fails + 1))
fi

# Плейсхолдеры шаблона обязаны быть подставлены: пустой DATA оставил бы страницу
# без вопросов и без фильтра, при внешне целой вёрстке.
if grep -q "__DATA_JSON__\|__STORE_KEY_JSON__" "$PAGE"; then
  echo "FAIL  плейсхолдер шаблона не подставлен"
  fails=$((fails + 1))
else
  echo "ok    данные страницы подставлены"
fi

for token in 'id="filters"' 'id="promptOut"' 'id="downloadBtn"' "class='triggers'" 'textarea class="answer"'; do
  case "$token" in
    'textarea class="answer"') pattern="class='answer'" ;;
    *) pattern="$token" ;;
  esac
  if grep -q "$pattern" "$PAGE"; then
    echo "ok    на странице есть: $pattern"
  else
    echo "FAIL  на странице нет: $pattern"
    fails=$((fails + 1))
  fi
done

# Гейт 22 прогоняется на исходнике и виден в подвале — расхождение версий
# шаблона должно быть заметно сразу, а не только при ручном запуске линтера.
if grep -q "гейт 22 — OK" "$PAGE"; then
  echo "ok    результат гейта 22 показан в подвале"
else
  echo "FAIL  результата гейта 22 в подвале нет"
  fails=$((fails + 1))
fi

# Тег блока гипотезы доезжает до карточки: без него на встрече не видно, какую
# часть гипотезы проверяет вопрос.
if grep -q "<span class='tag'>Метрика блокера</span>" "$PAGE"; then
  echo "ok    тег блока гипотезы доехал до карточки"
else
  echo "FAIL  тега блока гипотезы на карточке нет"
  fails=$((fails + 1))
fi

# Адресат [кому?] не мешает карточке появиться: вопрос задают и без владельца.
if grep -q 'data-whom="\[кому?\]"' "$PAGE"; then
  echo "ok    вопрос без владельца всё равно получил карточку"
else
  echo "FAIL  вопрос с адресатом [кому?] потерялся"
  fails=$((fails + 1))
fi

ids_of() { grep -o "data-qid='[0-9a-f]*'" "$1" | sort; }

# Ключ ответа — хэш текста вопроса. Пересобрали скрипт без правок — ключи те же,
# иначе все ответы встречи отвяжутся от своих вопросов.
cp "$GOLDEN" "$TMP/again-custdev.md"
python3 "$EXPORT" "$TMP/again-custdev.md" >/dev/null 2>&1
if diff <(ids_of "$PAGE") <(ids_of "$TMP/again-custdev.html") >/dev/null; then
  echo "ok    пересборка без правок не сдвинула ключи ответов"
else
  echo "FAIL  ключи ответов изменились при пересборке того же скрипта"
  fails=$((fails + 1))
fi

# Правка одного вопроса меняет только его ключ: остальные ответы остаются на месте.
sed 's/Как часто вы отвечаете/Как часто к вам приходят/' "$GOLDEN" > "$TMP/edited-custdev.md"
sed -i 's/Как часто к вам приходят вопросы по одному событию?/Как часто вопросы повторяются?/' "$TMP/edited-custdev.md"
python3 "$EXPORT" "$TMP/edited-custdev.md" >/dev/null 2>&1
changed=$(comm -13 <(ids_of "$PAGE") <(ids_of "$TMP/edited-custdev.html") | wc -l)
if [ "$changed" -eq 1 ]; then
  echo "ok    правка одного вопроса сдвинула ровно один ключ"
else
  echo "FAIL  правка одного вопроса сдвинула ключей: $changed (ожидался 1)"
  fails=$((fails + 1))
fi

# Экспортёр — инструмент, а не гейт: на сломанном скрипте он обязан собрать
# страницу, а не упасть. Отказ по методологии выносит линтер (гейт 22).
cp "$BROKEN" "$TMP/broken-custdev.md"
if python3 "$EXPORT" "$TMP/broken-custdev.md" >/dev/null 2>&1 && [ -f "$TMP/broken-custdev.html" ]; then
  echo "ok    сломанный скрипт не роняет экспортёр"
else
  echo "FAIL  экспортёр упал на сломанном скрипте"
  fails=$((fails + 1))
fi
if grep -q "гейт 22 — FAIL" "$TMP/broken-custdev.html"; then
  echo "ok    подвал сломанной страницы честно показывает FAIL гейта"
else
  echo "FAIL  подвал сломанной страницы не показал FAIL гейта"
  fails=$((fails + 1))
fi

# Служебный HTML-комментарий фикстуры на страницу не попадает ни разметкой, ни текстом.
if grep -q "Негативная фикстура\|&lt;!--" "$TMP/broken-custdev.html"; then
  echo "FAIL  служебный комментарий виден на странице"
  fails=$((fails + 1))
else
  echo "ok    служебные комментарии на страницу не попали"
fi

if [ "$fails" -eq 0 ]; then
  echo "Все проверки пройдены."
  exit 0
fi
echo "Провалов: $fails"
exit 1
