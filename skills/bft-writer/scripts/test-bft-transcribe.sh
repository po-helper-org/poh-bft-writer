#!/bin/bash
# Самотест транскрибатора: конвейер «запись → ffmpeg → whisper-cli → transcript.md»
# и его коды выхода. Распознаватель подменён стабом (`--whisper-bin`), чтобы тест
# не тянул модель на полтора гигабайта и не зависел от качества распознавания;
# ffmpeg — настоящий (без него тест пропускается, не падает).
# Запуск из корня репозитория: bash skills/bft-writer/scripts/test-bft-transcribe.sh
set -u

SCRIPT="skills/bft-writer/scripts/bft-transcribe.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fails=0
ok()   { echo "ok    $1"; }
fail() { echo "FAIL  $1"; fails=$((fails + 1)); }

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "skip  ffmpeg не установлен — конвейер не проверить (brew install ffmpeg)"
  exit 0
fi

# Синтетическая «запись» в контейнере диктофона iPhone: секунда синуса в .m4a.
ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=440:duration=1" -c:a aac "$TMP/meeting.m4a"
[ -f "$TMP/meeting.m4a" ] || { fail "ffmpeg не собрал тестовую запись"; exit 1; }

# Стаб whisper-cli: проверяет, что получил 16 кГц моно WAV и модель, и пишет
# «распознанный» текст в <of>.txt — ровно так, как настоящий бинарник с -otxt.
STUB="$TMP/whisper-cli"
cat >"$STUB" <<'EOF'
#!/bin/bash
of=""; f=""; m=""; l=""
while [ $# -gt 0 ]; do
  case "$1" in
    -of) of="$2"; shift ;;
    -f)  f="$2"; shift ;;
    -m)  m="$2"; shift ;;
    -l)  l="$2"; shift ;;
  esac
  shift
done
[ -f "$f" ] || { echo "нет wav: $f" >&2; exit 1; }
[ -f "$m" ] || { echo "нет модели: $m" >&2; exit 1; }
echo "$l" >"$of.lang"
if [ "${STUB_EMPTY:-}" = "1" ]; then
  printf '[BLANK_AUDIO]\n\n' >"$of.txt"
else
  printf ' Заказчик просил личный кабинет.\n\n[BLANK_AUDIO]\n Срок — до конца квартала.\n' >"$of.txt"
fi
EOF
chmod +x "$STUB"

MODELS="$TMP/models"
mkdir -p "$MODELS"
: >"$MODELS/ggml-large-v3-turbo.bin"

run() { python3 "$SCRIPT" --whisper-bin "$STUB" --model-dir "$MODELS" --no-download "$@"; }

# 1. Штатный прогон: транскрипт рядом с записью, frontmatter, текст без служебных строк.
if out=$(run "$TMP/meeting.m4a" 2>"$TMP/err1"); then
  ok "штатный прогон завершился кодом 0"
else
  fail "штатный прогон упал: $(cat "$TMP/err1")"
fi
T="$TMP/meeting.transcript.md"
[ -f "$T" ] && ok "транскрипт лежит рядом с записью ($T)" || fail "нет $T"
grep -q '^source_audio: .*meeting.m4a$' "$T" && ok "frontmatter несёт путь к записи" || fail "нет source_audio во frontmatter"
grep -q '^duration: 00:00:0[0-9]$' "$T" && ok "длительность определена через ffprobe" || fail "duration не заполнена: $(grep '^duration' "$T")"
grep -q '^model: large-v3-turbo$' "$T" && ok "модель по умолчанию — large-v3-turbo" || fail "модель во frontmatter не та"
grep -q '^Заказчик просил личный кабинет.$' "$T" && ok "сегменты распознавания — строками, без ведущего пробела" || fail "текст сегмента не найден"
grep -q 'BLANK_AUDIO' "$T" && fail "служебная строка [BLANK_AUDIO] попала в транскрипт" || ok "служебные строки whisper отфильтрованы"
echo "$out" | grep -q "^Транскрипт: $T" && ok "в stdout — строка «Транскрипт: <путь>»" || fail "stdout без строки Транскрипт: $out"

# 2. Язык по умолчанию — русский; --language уходит в whisper-cli как есть.
# Обёртка над стабом пишет переданный -l в лог: временный wav удаляется вместе с tmp скрипта.
LANG_LOG="$TMP/langlog"
cat >"$TMP/whisper-lang" <<EOF
#!/bin/bash
"$STUB" "\$@"
while [ \$# -gt 0 ]; do [ "\$1" = "-l" ] && echo "\$2" >>"$LANG_LOG"; shift; done
EOF
chmod +x "$TMP/whisper-lang"
python3 "$SCRIPT" --whisper-bin "$TMP/whisper-lang" --model-dir "$MODELS" --no-download --out "$TMP/l1.md" "$TMP/meeting.m4a" >/dev/null 2>&1
python3 "$SCRIPT" --whisper-bin "$TMP/whisper-lang" --model-dir "$MODELS" --no-download --language auto --out "$TMP/l2.md" "$TMP/meeting.m4a" >/dev/null 2>&1
if [ "$(sed -n 1p "$LANG_LOG")" = "ru" ] && [ "$(sed -n 2p "$LANG_LOG")" = "auto" ]; then
  ok "язык: дефолт ru, --language передаётся в whisper-cli"
else
  fail "язык передан неверно: $(tr '\n' ' ' <"$LANG_LOG")"
fi

# 3. Несколько записей → по транскрипту на каждую в каталоге --out.
cp "$TMP/meeting.m4a" "$TMP/part2.m4a"
run --out "$TMP/many" "$TMP/meeting.m4a" "$TMP/part2.m4a" >/dev/null 2>&1
if [ -f "$TMP/many/meeting.transcript.md" ] && [ -f "$TMP/many/part2.transcript.md" ]; then
  ok "несколько записей — по файлу на каждую в каталоге --out"
else
  fail "транскрипты нескольких записей не собраны: $(ls "$TMP/many" 2>/dev/null)"
fi

# 4. Коды выхода: файл не найден (2), не аудио (2), нет модели без загрузки (4),
#    нет whisper-cli (3), пустое распознавание (5). Стенографист по ним останавливается.
run "$TMP/absent.m4a" >/dev/null 2>&1; [ $? -eq 2 ] && ok "нет файла — код 2" || fail "нет файла — ожидался код 2"
echo "# summary" >"$TMP/note.md"
run "$TMP/note.md" >/dev/null 2>&1; [ $? -eq 2 ] && ok "путь к .md — не запись, код 2" || fail ".md принят как запись"
run --model tiny "$TMP/meeting.m4a" >/dev/null 2>&1; [ $? -eq 4 ] && ok "нет модели и --no-download — код 4" || fail "нет модели — ожидался код 4"
python3 "$SCRIPT" --whisper-bin "$TMP/nope" --model-dir "$MODELS" --no-download "$TMP/meeting.m4a" >/dev/null 2>&1
[ $? -eq 3 ] && ok "нет whisper-cli — код 3" || fail "нет whisper-cli — ожидался код 3"
STUB_EMPTY=1 run --out "$TMP/empty.md" "$TMP/meeting.m4a" >/dev/null 2>"$TMP/err5"
if [ $? -eq 5 ] && [ ! -f "$TMP/empty.md" ] && grep -q "речь не распознана" "$TMP/err5"; then
  ok "речь не распознана — код 5, файл не пишется, причина в stderr"
else
  fail "пустое распознавание: код $?, файл $([ -f "$TMP/empty.md" ] && echo есть || echo нет)"
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "Все проверки пройдены."
else
  echo "Провалено проверок: $fails"
  exit 1
fi
