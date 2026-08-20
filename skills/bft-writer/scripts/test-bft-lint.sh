#!/bin/bash
# Самотест линтера: золотые фикстуры проходят, негативная — падает с ожидаемыми кодами.
# Запуск из корня репозитория: bash skills/bft-writer/scripts/test-bft-lint.sh
set -u

LINT="skills/bft-writer/scripts/bft-lint.py"
GOLDEN=(
  "skills/bft-fast/examples/golden_document.md"
  "skills/bft-deep-swarm/examples/golden_deep_document.md"
)
BROKEN="skills/bft-writer/scripts/fixtures/broken_document.md"
# Коды, которые негативная фикстура обязана поднять. Пропал код — линтер ослаб.
EXPECTED_CODES=(BD001 HD004 HD006 CT006 TB001 TB002 DP001 CN002 CN006)

fails=0

for doc in "${GOLDEN[@]}"; do
  if out=$(python3 "$LINT" "$doc" 2>&1) && [ -z "${out##*OK*}" ]; then
    echo "ok    golden $doc"
  else
    echo "FAIL  golden $doc — линтер отклонил эталон:"
    echo "$out" | sed 's/^/        /'
    fails=$((fails + 1))
  fi
done

broken_out=$(python3 "$LINT" "$BROKEN" 2>&1)
broken_rc=$?
if [ "$broken_rc" -eq 0 ]; then
  echo "FAIL  broken $BROKEN — линтер вернул 0 на заведомо сломанном документе"
  fails=$((fails + 1))
else
  echo "ok    broken $BROKEN — код выхода $broken_rc"
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
