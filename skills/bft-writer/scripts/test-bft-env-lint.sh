#!/bin/bash
# Самотест линтера окружения: корректный конфиг проходит, негативный падает
# с ожидаемыми кодами, отсутствующий файл даёт код 2.
# Запуск из корня репозитория: bash skills/bft-writer/scripts/test-bft-env-lint.sh
set -u

LINT="skills/bft-writer/scripts/bft-env-lint.py"
GOOD="skills/bft-writer/scripts/fixtures/good_mcp_config.json"
BROKEN="skills/bft-writer/scripts/fixtures/broken_mcp_config.json"
# Коды, которые негативная фикстура обязана поднять. Пропал код — линтер ослаб.
EXPECTED_CODES=(EN002 EN003 EN004 EN005)

fails=0

if out=$(python3 "$LINT" "$GOOD" 2>&1) && [ -z "${out##*OK*}" ]; then
  echo "ok    good $GOOD"
else
  echo "FAIL  good $GOOD — линтер отклонил корректный конфиг:"
  echo "$out" | sed 's/^/        /'
  fails=$((fails + 1))
fi

broken_out=$(python3 "$LINT" "$BROKEN" 2>&1)
if [ $? -eq 0 ]; then
  echo "FAIL  broken $BROKEN — линтер вернул 0 на заведомо дефектном конфиге"
  fails=$((fails + 1))
else
  echo "ok    broken $BROKEN — ненулевой код выхода"
fi

for code in "${EXPECTED_CODES[@]}"; do
  if echo "$broken_out" | grep -q " $code "; then
    echo "ok    код $code поднят"
  else
    echo "FAIL  код $code не поднят на негативной фикстуре"
    fails=$((fails + 1))
  fi
done

python3 "$LINT" "$BROKEN/nope.json" >/dev/null 2>&1
if [ $? -eq 2 ]; then
  echo "ok    отсутствующий конфиг — код выхода 2 (EN001)"
else
  echo "FAIL  отсутствующий конфиг не дал код 2"
  fails=$((fails + 1))
fi

# Секрет-заглушка и ссылка на окружение находкой быть не должны.
if python3 "$LINT" "$GOOD" 2>&1 | grep -q "EN004"; then
  echo "FAIL  EN004 срабатывает на \${VAR}-ссылке — ложное срабатывание"
  fails=$((fails + 1))
else
  echo "ok    EN004 молчит на ссылке в окружение"
fi

if [ "$fails" -eq 0 ]; then
  echo "Все проверки пройдены."
  exit 0
fi
echo "Провалов: $fails"
exit 1
