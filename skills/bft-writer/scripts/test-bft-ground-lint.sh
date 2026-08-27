#!/bin/bash
# Самотест grounding-линтера: золотые документы чисты относительно своих источников,
# документ с утечкой из чужого примера — падает с ожидаемыми токенами.
# Запуск из корня репозитория: bash skills/bft-writer/scripts/test-bft-ground-lint.sh
set -u

LINT="skills/bft-writer/scripts/bft-ground-lint.py"
LEAK="skills/bft-writer/scripts/fixtures/leaked_document.md"
LEAK_SOURCE="skills/bft-fast/examples/golden_summary_precision.md"
# Токены чужого эпика, которые фикстура обязана поднять. Пропал — линтер ослаб.
EXPECTED_TOKENS=(MRS FAQ)

fails=0

check_clean() {
  local doc="$1" src="$2"
  if out=$(python3 "$LINT" "$doc" --source "$src" 2>&1) && [ -z "${out##*OK*}" ]; then
    echo "ok    clean $doc"
  else
    echo "FAIL  clean $doc — линтер поднял сущности на эталоне:"
    echo "$out" | sed 's/^/        /'
    fails=$((fails + 1))
  fi
}

check_clean "skills/bft-fast/examples/golden_document.md" "skills/bft-fast/examples/golden_summary.md"
check_clean "skills/bft-deep-swarm/examples/golden_deep_document.md" "skills/bft-fast/examples/golden_summary.md"

leak_out=$(python3 "$LINT" "$LEAK" --source "$LEAK_SOURCE" --strict 2>&1)
leak_rc=$?
if [ "$leak_rc" -eq 0 ]; then
  echo "FAIL  leak $LEAK — линтер вернул 0 на документе с утечкой из чужого примера"
  fails=$((fails + 1))
else
  echo "ok    leak $LEAK — код выхода $leak_rc"
fi

for token in "${EXPECTED_TOKENS[@]}"; do
  if echo "$leak_out" | grep -q "«$token»"; then
    echo "ok    токен $token пойман"
  else
    echo "FAIL  токен $token не пойман на фикстуре с утечкой"
    fails=$((fails + 1))
  fi
done

if [ "$fails" -eq 0 ]; then
  echo "Все проверки пройдены."
  exit 0
fi
echo "Провалов: $fails"
exit 1
