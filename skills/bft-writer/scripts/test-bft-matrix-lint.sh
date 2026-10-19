#!/bin/bash
# Самотест линтера матрицы исполнения (гейт 23): эталон проходит без предупреждений,
# негативная фикстура поднимает каждый код, черновик допускает [УТОЧНИТЬ].
# Запуск из корня репозитория: bash skills/bft-writer/scripts/test-bft-matrix-lint.sh
set -u

LINT="skills/bft-writer/scripts/bft-matrix-lint.py"
GOLDEN="skills/bft-exec-matrix/examples/golden_exec_matrix.md"
BROKEN="skills/bft-writer/scripts/fixtures/broken_exec_matrix.md"
# Дата прогона фиксирована: иначе проверка свежести (MX021) сделала бы тест зависимым от календаря.
TODAY="2026-10-28"
# Коды, которые негативная фикстура обязана поднять. Пропал код — линтер ослаб.
EXPECTED_ERRORS=(MX001 MX002 MX003 MX004 MX005 MX006 MX007 MX008 MX009 MX010 MX011 MX012 MX013 MX014 MX015 MX016)
EXPECTED_WARNS=(MX021 MX022 MX023)
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fails=0

golden_out=$(python3 "$LINT" --today "$TODAY" "$GOLDEN" 2>&1)
if [ $? -eq 0 ] && [ -z "${golden_out##*OK*}" ]; then
  echo "ok    golden $GOLDEN"
else
  echo "FAIL  golden $GOLDEN — линтер отклонил эталон:"
  echo "$golden_out" | sed 's/^/        /'
  fails=$((fails + 1))
fi

# Эталон — образец формы, а не пример нарушений.
if echo "$golden_out" | grep -q "WARN"; then
  echo "FAIL  эталон несёт предупреждения:"
  echo "$golden_out" | grep "WARN" | sed 's/^/        /'
  fails=$((fails + 1))
else
  echo "ok    эталон без предупреждений"
fi

broken_out=$(python3 "$LINT" --today "$TODAY" "$BROKEN" 2>&1)
if [ $? -eq 0 ]; then
  echo "FAIL  broken $BROKEN — линтер вернул 0 на заведомо сломанной матрице"
  fails=$((fails + 1))
else
  echo "ok    broken $BROKEN — ненулевой код выхода"
fi

for code in "${EXPECTED_ERRORS[@]}"; do
  if echo "$broken_out" | grep -q "ERROR $code"; then
    echo "ok    ловит $code"
  else
    echo "FAIL  не ловит $code"
    fails=$((fails + 1))
  fi
done
for code in "${EXPECTED_WARNS[@]}"; do
  if echo "$broken_out" | grep -q "WARN $code"; then
    echo "ok    предупреждает $code"
  else
    echo "FAIL  не предупреждает $code"
    fails=$((fails + 1))
  fi
done

# Черновик: [УТОЧНИТЬ] и пустое «Согласовано» — норма, это и есть открытые вопросы старта.
# Копия эталона рядом с ним, чтобы относительный путь к БФТ остался рабочим.
DRAFT="skills/bft-exec-matrix/examples/.draft-test-matrix.md"
sed -e 's/^status: в исполнении$/status: черновик/' \
    -e 's/| версия 1, 15.10.2026 |$/| — |/' \
    -e 's/| Контент — Елена Котова | Стыковка | 24.10.2026 |/| Контент — [УТОЧНИТЬ у Елены Котовой] | Стыковка | 24.10.2026 |/' \
    "$GOLDEN" > "$DRAFT"
draft_out=$(python3 "$LINT" --today "$TODAY" "$DRAFT" 2>&1)
draft_rc=$?
rm -f "$DRAFT"
if [ $draft_rc -eq 0 ]; then
  echo "ok    черновик с [УТОЧНИТЬ] и без согласий проходит"
else
  echo "FAIL  черновик отклонён:"
  echo "$draft_out" | sed 's/^/        /'
  fails=$((fails + 1))
fi

# Матрица по fast-документу бесполезна: покрытие нечем проверить (MX007).
cp "$GOLDEN" "$TMP/m.md"
cp skills/bft-fast/examples/golden_document.md "$TMP/fast.md"
sed -i.bak -e 's#^source: .*#source: fast.md#' "$TMP/m.md"
fast_out=$(python3 "$LINT" --today "$TODAY" "$TMP/m.md" 2>&1)
if echo "$fast_out" | grep -q "ERROR MX007.*deep"; then
  echo "ok    источник не deep — отказ MX007"
else
  echo "FAIL  матрица по fast-документу не отклонена:"
  echo "$fast_out" | sed 's/^/        /'
  fails=$((fails + 1))
fi

# Закрытая матрица: все строки приняты или N/A — иначе закрывать нечего.
sed -e 's/^status: в исполнении$/status: закрыта/' "$GOLDEN" > "skills/bft-exec-matrix/examples/.closed-test-matrix.md"
closed_out=$(python3 "$LINT" --today "$TODAY" "skills/bft-exec-matrix/examples/.closed-test-matrix.md" 2>&1)
rm -f "skills/bft-exec-matrix/examples/.closed-test-matrix.md"
if echo "$closed_out" | grep -q "ERROR MX013.*закрыт"; then
  echo "ok    закрытая матрица с незакрытыми строками — отказ MX013"
else
  echo "FAIL  закрытая матрица с открытыми строками не отклонена:"
  echo "$closed_out" | sed 's/^/        /'
  fails=$((fails + 1))
fi

# JSON-вывод — для страницы ревью и бота.
if python3 "$LINT" --today "$TODAY" --format json "$BROKEN" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d and d[0]["code"]' 2>/dev/null; then
  echo "ok    --format json разбирается"
else
  echo "FAIL  --format json не разбирается"
  fails=$((fails + 1))
fi

if [ $fails -eq 0 ]; then
  echo "PASS  гейт 23 (bft-matrix-lint)"
else
  echo "FAIL  гейт 23: $fails проверок не прошли"
fi
exit $fails
