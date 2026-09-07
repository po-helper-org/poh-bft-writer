#!/bin/bash
# Самотест линтера скрипта интервью: эталон проходит, негативная фикстура падает с ожидаемыми кодами.
# Запуск из корня репозитория: bash skills/bft-writer/scripts/test-bft-custdev-lint.sh
set -u

LINT="skills/bft-writer/scripts/bft-custdev-lint.py"
GOLDEN="skills/bft-custdev/examples/golden_custdev_script.md"
BROKEN="skills/bft-writer/scripts/fixtures/broken_custdev_script.md"
# Коды, которые негативная фикстура обязана поднять. Пропал код — линтер ослаб.
EXPECTED_ERRORS=(CD001 CD002 CD003 CD004 CD005 CD006 CD007 CD008 CD009)
EXPECTED_WARNS=(CD011 CD012 CD013)

fails=0

golden_out=$(python3 "$LINT" "$GOLDEN" 2>&1)
if [ $? -eq 0 ] && [ -z "${golden_out##*OK*}" ]; then
  echo "ok    golden $GOLDEN"
else
  echo "FAIL  golden $GOLDEN — линтер отклонил эталон:"
  echo "$golden_out" | sed 's/^/        /'
  fails=$((fails + 1))
fi

# Эталон воспроизводит канон методички дословно, а канон держит закрытые уточнения внутри
# ячейки («Каждый ли раз вы именно таким образом решаете проблему?», этап 11). Замечание по
# форме обязано остаться предупреждением: превратись оно в ошибку, линтер отверг бы источник.
if echo "$golden_out" | grep -q "WARN CD011"; then
  echo "ok    golden несёт WARN CD011 и всё равно проходит — форма не отвергает канон"
else
  echo "FAIL  golden не поднял WARN CD011 — проверка формы вопроса отключилась"
  fails=$((fails + 1))
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

if [ "$fails" -eq 0 ]; then
  echo "Все проверки пройдены."
  exit 0
fi
echo "Провалов: $fails"
exit 1
