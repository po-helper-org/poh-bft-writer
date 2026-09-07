#!/bin/bash
# Самотест страницы интервью: страница собирается из эталона, ведёт по одному вопросу,
# ключ ответа переживает пересборку скрипта, снятое не возвращается.
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

# Интервью на 5–10 минут: карточек столько же, сколько вопросов в документе, и не больше
# двенадцати. Разрастись молча — и страница снова превращается в допрос.
cards=$(grep -c "<article class='q'" "$PAGE")
if [ "$cards" -ge 3 ] && [ "$cards" -le 12 ]; then
  echo "ok    вопросов на странице $cards — разговор укладывается в 5–10 минут"
else
  echo "FAIL  вопросов на странице $cards — вне коридора 3…12"
  fails=$((fails + 1))
fi

# Опросник ведёт по одному вопросу: все карточки приезжают скрытыми, показывает их скрипт.
visible=$(grep -c "<article class='q'[^>]*hidden>" "$PAGE")
if [ "$visible" -eq "$cards" ]; then
  echo "ok    все карточки скрыты в разметке, показывает их опросник"
else
  echo "FAIL  скрыто $visible из $cards карточек — страница развернётся простынёй"
  fails=$((fails + 1))
fi

if grep -q "__DATA_JSON__\|__STORE_KEY_JSON__" "$PAGE"; then
  echo "FAIL  плейсхолдер шаблона не подставлен"
  fails=$((fails + 1))
else
  echo "ok    данные страницы подставлены"
fi

# Органы управления. Пропажа любого делает страницу нерабочей на встрече, а вёрстка при
# этом остаётся внешне целой.
for pattern in 'data-drawer="meta"' 'data-drawer="agenda"' 'id="agendaText"' 'id="agendaMail"' \
               'id="navPanel"' 'id="navToggle"' "class='nav-item'" 'id="promptOut"' \
               'id="downloadBtn"' 'id="nextBtn"' 'id="prevBtn"' 'id="skipBtn"' 'id="barFill"' \
               "class='answer'" "class='attach-input'" "class='attach-list'" \
               'data-pane="outcomes"' "table class='outcomes'"; do
  if grep -q "$pattern" "$PAGE"; then
    echo "ok    на странице есть: $pattern"
  else
    echo "FAIL  на странице нет: $pattern"
    fails=$((fails + 1))
  fi
done

# Снятое по итогам живого прогона не должно вернуться незаметно: верхняя панель, вкладки
# «Подсказки» и «Результат», строка «этап · тег» над вопросом, подвал со статусом гейта.
for token in 'class="topbar"' 'data-drawer="hints"' 'data-drawer="result"' "class='q-ctx'" \
             'class="doc-foot"' "class='crumb'"; do
  if grep -q "$token" "$PAGE"; then
    echo "FAIL  на страницу вернулось снятое: $token"
    fails=$((fails + 1))
  else
    echo "ok    снятое не вернулось: $token"
  fi
done

# Промт живёт на экране итога, а не в боковой панели: собирать его посреди встречи незачем.
if python3 - "$PAGE" <<'PYEOF'
import re, sys
html = open(sys.argv[1], encoding="utf-8").read()
finish = re.search(r'<section class="finish".*?</section>', html, re.S)
sys.exit(0 if finish and 'id="promptOut"' in finish.group(0) else 1)
PYEOF
then
  echo "ok    промт и выгрузка стоят на экране итога"
else
  echo "FAIL  промта нет на экране итога"
  fails=$((fails + 1))
fi

# Письмо участникам собирается на сервере и лежит в разметке готовым текстом.
if grep -q "Что выясняем:" "$PAGE" && grep -q "Вопросы:" "$PAGE"; then
  echo "ok    заготовка письма собрана"
else
  echo "FAIL  в заготовке письма нет целей или вопросов"
  fails=$((fails + 1))
fi
# Ни слага эпика, ни маркера артефакта в теме: письмо уходит наружу.
if grep -qE "Тема: CustDev — (\[CustDev\]|[a-z0-9-]+:)" "$PAGE"; then
  echo "FAIL  в тему письма протёк слаг эпика или маркер артефакта"
  fails=$((fails + 1))
else
  echo "ok    тема письма без служебных маркеров"
fi
# Неназванный участник адресатом не бывает: приглашать некого.
if python3 - "$PAGE" <<'PYEOF'
import html as h, re, sys
page = open(sys.argv[1], encoding="utf-8").read()
agenda = h.unescape(re.search(r'<textarea id="agendaText"[^>]*>(.*?)</textarea>', page, re.S).group(1))
sys.exit(1 if "[кому?]" in agenda else 0)
PYEOF
then
  echo "ok    [кому?] в письмо адресатом не попал"
else
  echo "FAIL  [кому?] попал в письмо адресатом"
  fails=$((fails + 1))
fi

# Ключ вопроса стоит в двух местах: на карточке и в пункте панели навигации. Считаем
# уникальные, иначе одна правка выглядит как две.
# Шесть исходов — контракт результата, и на странице их видно все, с отметкой пробелов.
outcomes=$(grep -o "<tr data-gap=" "$PAGE" | wc -l)
if [ "$outcomes" -eq 6 ]; then
  echo "ok    на странице все шесть исходов"
else
  echo "FAIL  исходов на странице $outcomes вместо шести"
  fails=$((fails + 1))
fi
if grep -q "data-gap='1'" "$PAGE"; then
  echo "ok    пробелы отмечены отдельно от известного"
else
  echo "FAIL  пробелы на странице не отмечены"
  fails=$((fails + 1))
fi

# Вложение прикладывается к каждому вопросу: скриншот и фото доски несут больше, чем
# участник успевает проговорить. Поле должно быть у всех карточек, а не у первой.
attach=$(grep -o "class='attach-input'" "$PAGE" | wc -l)
if [ "$attach" -eq "$cards" ]; then
  echo "ok    поле вложений у каждого вопроса ($attach)"
else
  echo "FAIL  полей вложений $attach при $cards вопросах"
  fails=$((fails + 1))
fi

ids_of() { grep -o "data-qid='[0-9a-f]*'" "$1" | sort -u; }

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
sed 's/Кто заметит это первым?/Кто увидит это первым?/' "$GOLDEN" > "$TMP/edited-custdev.md"
python3 "$EXPORT" "$TMP/edited-custdev.md" >/dev/null 2>&1
changed=$(comm -13 <(ids_of "$PAGE") <(ids_of "$TMP/edited-custdev.html") | wc -l)
if [ "$changed" -eq 1 ]; then
  echo "ok    правка одного вопроса сдвинула ровно один ключ"
else
  echo "FAIL  правка одного вопроса сдвинула ключей: $changed (ожидался 1)"
  fails=$((fails + 1))
fi

# Экспортёр — инструмент, а не гейт: на сломанном скрипте он обязан собрать страницу,
# а не упасть. Отказ по методологии выносит линтер (гейт 22).
cp "$BROKEN" "$TMP/broken-custdev.md"
if python3 "$EXPORT" "$TMP/broken-custdev.md" >/dev/null 2>&1 && [ -f "$TMP/broken-custdev.html" ]; then
  echo "ok    сломанный скрипт не роняет экспортёр"
else
  echo "FAIL  экспортёр упал на сломанном скрипте"
  fails=$((fails + 1))
fi
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
