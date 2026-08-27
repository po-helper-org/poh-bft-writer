#!/bin/bash
# Самотест линтера карты контекста: golden-карта проходит, негативная — падает с ожидаемыми кодами.
# Запуск из корня репозитория: bash skills/bft-writer/scripts/test-bft-recon-lint.sh
set -u

LINT="skills/bft-writer/scripts/bft-recon-lint.py"
GOLDEN="skills/bft-recon/examples/golden_context_map.md"
BROKEN="skills/bft-writer/scripts/fixtures/broken_context_map.md"
# Коды, которые негативная фикстура обязана поднять. Пропал код — линтер ослаб.
EXPECTED_CODES=(RC001 RC002 RC003 RC004 RC005)

fails=0

if out=$(python3 "$LINT" "$GOLDEN" 2>&1) && [ -z "${out##*OK*}" ]; then
  echo "ok    golden $GOLDEN"
else
  echo "FAIL  golden $GOLDEN — линтер отклонил эталон:"
  echo "$out" | sed 's/^/        /'
  fails=$((fails + 1))
fi

broken_out=$(python3 "$LINT" "$BROKEN" 2>&1)
if [ $? -eq 0 ]; then
  echo "FAIL  broken $BROKEN — линтер вернул 0 на заведомо сломанной карте"
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

if [ "$fails" -eq 0 ]; then
  echo "Все проверки пройдены."
  exit 0
fi
echo "Провалов: $fails"
exit 1
