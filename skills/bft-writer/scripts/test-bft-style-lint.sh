#!/bin/bash
# Самотест лексического линтера: золотые фикстуры проходят без единого срабатывания,
# фикстура со слопом падает и поднимает ожидаемые коды.
# Запуск из корня репозитория: bash skills/bft-writer/scripts/test-bft-style-lint.sh
set -u

LINT="skills/bft-writer/scripts/bft-style-lint.py"
GOLDEN=(
  "skills/bft-fast/examples/golden_document.md"
  "skills/bft-writer/examples/golden_bft_example.md"
  "skills/bft-writer/examples/ideal_bft.md"
)
SLOP="skills/bft-writer/scripts/fixtures/slop_document.md"
# Коды, которые фикстура со слопом обязана поднять. Пропал код — линтер ослаб.
EXPECTED_CODES=(
  SW001 SW002 SW003 SW004 SW005 SW006 SW012 SW013 SW015
  HG001 HG002 HG003
  MC001 MC003 MC004
  QF001 QF002 QF003 QF004
  BZ001 BZ002 BZ004 BZ005 BZ006 BZ007
)

fails=0

for doc in "${GOLDEN[@]}"; do
  if out=$(python3 "$LINT" "$doc" 2>&1) && [ -z "${out##*OK*}" ]; then
    echo "ok    golden $doc"
  else
    echo "FAIL  golden $doc — линтер поднял слоп на эталоне:"
    echo "$out" | sed 's/^/        /'
    fails=$((fails + 1))
  fi
done

slop_out=$(python3 "$LINT" "$SLOP" 2>&1)
slop_rc=$?
if [ "$slop_rc" -eq 0 ]; then
  echo "FAIL  slop $SLOP — линтер вернул 0 на заведомо заслоплённом документе"
  fails=$((fails + 1))
else
  echo "ok    slop $SLOP — код выхода $slop_rc"
fi

for code in "${EXPECTED_CODES[@]}"; do
  if echo "$slop_out" | grep -q " $code "; then
    echo "ok    код $code поднят"
  else
    echo "FAIL  код $code не поднят на фикстуре со слопом"
    fails=$((fails + 1))
  fi
done

if [ "$fails" -eq 0 ]; then
  echo "Все проверки пройдены."
  exit 0
fi
echo "Провалов: $fails"
exit 1
