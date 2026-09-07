#!/bin/bash
# Самотест линтера скрипта интервью: эталон проходит, негативная фикстура падает с ожидаемыми кодами.
# Запуск из корня репозитория: bash skills/bft-writer/scripts/test-bft-custdev-lint.sh
set -u

LINT="skills/bft-writer/scripts/bft-custdev-lint.py"
GOLDEN="skills/bft-custdev/examples/golden_custdev_script.md"
BROKEN="skills/bft-writer/scripts/fixtures/broken_custdev_script.md"
# Коды, которые негативная фикстура обязана поднять. Пропал код — линтер ослаб.
EXPECTED_ERRORS=(CD001 CD002 CD003 CD004 CD005 CD006 CD007 CD008 CD009 CD010)
EXPECTED_WARNS=(CD011 CD012 CD013 CD014 CD015)

fails=0

golden_out=$(python3 "$LINT" "$GOLDEN" 2>&1)
if [ $? -eq 0 ] && [ -z "${golden_out##*OK*}" ]; then
  echo "ok    golden $GOLDEN"
else
  echo "FAIL  golden $GOLDEN — линтер отклонил эталон:"
  echo "$golden_out" | sed 's/^/        /'
  fails=$((fails + 1))
fi

# Интервью на 5–10 минут: эталон обязан оставаться коротким. Разрастись он молча — и
# страница снова превратится в допрос, ради ухода от которого длину и ограничили.
qcount=$(sed -n '/^## Вопросы/,/^## Чего/p' "$GOLDEN" | grep -cE '^\| В-[0-9]+ ')
if [ "$qcount" -ge 3 ] && [ "$qcount" -le 12 ]; then
  echo "ok    в эталоне $qcount вопросов — разговор укладывается в 5–10 минут"
else
  echo "FAIL  в эталоне $qcount вопросов — вне коридора 3…12"
  fails=$((fails + 1))
fi

# Эталон не должен нести и предупреждений: он образец формы, а не пример нарушений.
if echo "$golden_out" | grep -q "WARN"; then
  echo "FAIL  эталон несёт предупреждения:"
  echo "$golden_out" | grep "WARN" | sed 's/^/        /'
  fails=$((fails + 1))
else
  echo "ok    эталон без предупреждений"
fi

broken_out=$(python3 "$LINT" "$BROKEN" 2>&1)
if [ $? -eq 0 ]; then
  echo "FAIL  broken $BROKEN — линтер вернул 0 на заведомо сломанном скрипте"
  fails=$((fails + 1))
else
  echo "ok    broken $BROKEN — ненулевой код выхода"
fi

for code in "${EXPECTED_ERRORS[@]}"; do
  if echo "$broken_out" | grep -q "ERROR $code "; then
    echo "ok    ошибка $code поднята"
  else
    echo "FAIL  ошибка $code не поднята на негативной фикстуре"
    fails=$((fails + 1))
  fi
done

for code in "${EXPECTED_WARNS[@]}"; do
  if echo "$broken_out" | grep -q "WARN $code "; then
    echo "ok    предупреждение $code поднято"
  else
    echo "FAIL  предупреждение $code не поднято на негативной фикстуре"
    fails=$((fails + 1))
  fi
done


# Шесть исходов — контракт результата. Пропади блок из эталона, и следующий скрипт соберут
# без приёмки или без измерения, а по ним потом пишут БФТ.
for block in "Для кого" "Какую проблему решаем" "Как принимается работа" \
             "Как поймём, что решает" "Кто вовлечён" "Какое решение видит запрашивающий"; do
  if grep -q "| $block |" "$GOLDEN"; then
    echo "ok    исход на месте: $block"
  else
    echo "FAIL  в эталоне нет исхода: $block"
    fails=$((fails + 1))
  fi
done

# Каждый вопрос помечен исходом: без тега он не закрывает ни один блок.
untagged=$(sed -n '/^## Вопросы/,/^## Чего/p' "$GOLDEN" | grep -E '^\| В-[0-9]+ ' \
  | grep -cvE '\((Для кого|Проблема|Приёмка|Измерение|Участники|Решение)\)')
if [ "$untagged" -eq 0 ]; then
  echo "ok    все вопросы эталона помечены исходом"
else
  echo "FAIL  вопросов без тега исхода: $untagged"
  fails=$((fails + 1))
fi

if [ "$fails" -eq 0 ]; then
  echo "Все проверки пройдены."
  exit 0
fi
echo "Провалов: $fails"
exit 1
